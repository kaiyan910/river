import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ExternalFormField, ExternalProcess, ExternalProcessDetail } from '@river/contracts';
import { type Database, processes, processVersions, serviceAccountProcesses } from '@river/db';
import type { FormField, TableColumn } from '@river/forms';
import { and, desc, eq } from 'drizzle-orm';
import { startFormOf } from '../process/processes.service.js';
import { DATABASE } from '../tokens.js';
import type { AuthenticatedServiceAccount } from './service-accounts.service.js';

/** 外部 API：Service Account 列出被授權發起的 Process，查詢目前版本的開始表單欄位。 */
@Injectable()
export class ExternalProcessesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** 只有被授權的 Process，依名稱排序；授權範圍只看 Service Account，不考慮 Initiator Role。 */
  async list(account: AuthenticatedServiceAccount): Promise<ExternalProcess[]> {
    return (await this.current(account.id)).map(({ dsl: _, ...p }) => p);
  }

  /** 沒有被授權的 Process 和不存在的一樣回 404，不透露有哪些 Process。 */
  async find(id: string, account: AuthenticatedServiceAccount): Promise<ExternalProcessDetail> {
    const [process] = await this.current(account.id, id);
    if (!process) throw new NotFoundException('找不到這個 Process');
    const { dsl, ...rest } = process;
    const form = startFormOf(dsl);
    return { ...rest, startForm: form && { fields: form.fields.map(toExternalField) } };
  }

  /** 被授權的 Process 各自的目前 Process Version（授權時已經確保至少發佈過一個版本）。 */
  private async current(serviceAccountId: string, processId?: string) {
    const rows = await this.db
      .selectDistinctOn([processVersions.processId], {
        id: processes.id,
        name: processes.name,
        version: processVersions.version,
        publishedAt: processVersions.publishedAt,
        dsl: processVersions.dsl,
      })
      .from(processVersions)
      .innerJoin(processes, eq(processes.id, processVersions.processId))
      .innerJoin(
        serviceAccountProcesses,
        and(
          eq(serviceAccountProcesses.processId, processVersions.processId),
          eq(serviceAccountProcesses.serviceAccountId, serviceAccountId),
        ),
      )
      .where(processId ? eq(processVersions.processId, processId) : undefined)
      .orderBy(processVersions.processId, desc(processVersions.version));
    return rows
      .map((r) => ({ ...r, publishedAt: r.publishedAt.toISOString() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** 內部的 Form 欄位轉成對外合約：拿掉 Designer 用的欄位 id，內部結構調整不影響外部系統。 */
function toExternalField(field: FormField): ExternalFormField {
  return {
    ...toExternalColumn(field),
    ...(field.columns && { columns: field.columns.map(toExternalColumn) }),
  };
}

function toExternalColumn<T extends FormField | TableColumn>(field: T) {
  const { key, label, type, required, help, rules, options } = field;
  return {
    key,
    label,
    type: type as T['type'],
    required,
    rules,
    ...(help !== undefined && { help }),
    ...(options && { options }),
  };
}
