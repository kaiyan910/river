import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ImportFailureCode, ImportParticipantsResult } from '@river/contracts';
import { authUsers, type Database, participants } from '@river/db';
import { eq } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import { z } from 'zod';
import type { ActiveParticipant } from '../auth/active-participant.js';
import type { Auth } from '../auth/create-auth.js';
import { AUTH, DATABASE } from '../tokens.js';
import { parseCsv } from './csv.js';
import { InvitationsService } from './invitations.service.js';
import { createParticipantAccount } from './provision-participant.js';

type Column = 'name' | 'email' | 'managerEmail';

/** 標題列可以使用的欄位名稱；比對前先轉小寫並去掉空白、底線、連字號與「的」。 */
const HEADER_ALIASES: Record<string, Column> = {
  name: 'name',
  姓名: 'name',
  email: 'email',
  電子郵件: 'email',
  manageremail: 'managerEmail',
  manager: 'managerEmail',
};

const NAME_MAX_LENGTH = 100;
const emailSchema = z.email();

/** 格式正確、等待檢查 email 與 Manager 的一行。 */
interface Row {
  line: number;
  name: string;
  email: string;
  managerEmail: string | null;
}

type Failure = ImportParticipantsResult['failed'][number];

/** 這一行的 Manager：沒有、檔案中的另一行，或現有的 Participant。 */
type ManagerRef = { kind: 'none' } | { kind: 'row'; row: Row } | { kind: 'existing'; id: string };

/**
 * CSV 匯入：檢查每一行的格式、email 與 Manager，有錯誤的行不匯入並列出行號與原因，其他行照常匯入並寄出邀請信。
 * Manager 可以是檔案中的另一行（與行的順序無關），也可以是現有的 Participant。
 */
@Injectable()
export class ParticipantImportService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AUTH) private readonly auth: Auth,
    private readonly invitations: InvitationsService,
    private readonly logger: Logger,
  ) {}

  async import(csv: string, inviter: ActiveParticipant): Promise<ImportParticipantsResult> {
    const failed: Failure[] = [];
    const fail = (line: number, email: string | null, code: ImportFailureCode, message: string) =>
      failed.push({ line, email, code, message });

    const rows = this.parseRows(csv, fail);
    const existing = await this.existingAccounts();

    // 檔案中重複的 email：無法判斷哪一行才對，全部不匯入。
    const linesByEmail = new Map<string, number[]>();
    for (const row of rows) {
      linesByEmail.set(row.email, [...(linesByEmail.get(row.email) ?? []), row.line]);
    }
    const candidates = new Map<string, Row>();
    for (const row of rows) {
      const lines = linesByEmail.get(row.email) ?? [];
      if (lines.length > 1) {
        const others = lines.filter((l) => l !== row.line).join('、');
        fail(row.line, row.email, 'duplicate_email', `email 與第 ${others} 行重複`);
      } else if (existing.has(row.email)) {
        fail(row.line, row.email, 'email_taken', '這個 email 已經有帳號');
      } else {
        candidates.set(row.email, row);
      }
    }

    // 解析 Manager。每一行最多一個 Manager，所以沿著 Manager 往上走，走回走過的行就是循環。
    const managerOf = new Map<Row, ManagerRef>();
    const failedRows = new Set<Row>();
    const resolved = new Set<Row>();
    /** Manager 排在前面的順序，建立帳號時照這個順序，Manager 一定先建立。 */
    const order: Row[] = [];
    /** 格式或 email 有錯誤的行；Manager 指向它們時說明是哪一行。同一個 email 有多行時記第一行。 */
    const failedLineByEmail = new Map<string | null, number>();
    for (const f of failed)
      if (!failedLineByEmail.has(f.email)) failedLineByEmail.set(f.email, f.line);

    const failRow = (row: Row, code: ImportFailureCode, message: string) => {
      failedRows.add(row);
      fail(row.line, row.email, code, message);
    };

    for (const start of candidates.values()) {
      const path: Row[] = [];
      let cur: Row | undefined = start;
      while (cur && !resolved.has(cur)) {
        const onPath = path.indexOf(cur);
        if (onPath >= 0) {
          const cycle = path.slice(onPath);
          const lines = cycle.map((r) => r.line).join(' → ');
          for (const row of cycle) {
            failRow(
              row,
              'manager_cycle',
              cycle.length === 1 ? 'Manager 不能是自己' : `Manager 關係形成循環（第 ${lines} 行）`,
            );
            resolved.add(row);
          }
          path.length = onPath;
          break;
        }
        path.push(cur);
        const ref = this.resolveManager(cur, candidates, existing, failedLineByEmail, failRow);
        if (!ref) {
          resolved.add(cur);
          path.pop();
          break;
        }
        managerOf.set(cur, ref);
        cur = ref.kind === 'row' ? ref.row : undefined;
      }
      // 由上往下處理這條路徑：Manager 那一行沒有匯入時，這一行也不匯入。
      for (const row of path.reverse()) {
        const ref = managerOf.get(row);
        if (ref?.kind === 'row' && failedRows.has(ref.row)) {
          failRow(row, 'manager_failed', `Manager（第 ${ref.row.line} 行）沒有匯入`);
        } else if (!failedRows.has(row)) {
          order.push(row);
        }
        resolved.add(row);
      }
    }

    // 依 Manager 優先的順序建立帳號並寄出邀請信。
    const imported: ImportParticipantsResult['imported'] = [];
    const createdId = new Map<Row, string>();
    for (const row of order) {
      const ref = managerOf.get(row) ?? { kind: 'none' };
      let managerId: string | null = null;
      if (ref.kind === 'existing') managerId = ref.id;
      if (ref.kind === 'row') {
        const id = createdId.get(ref.row);
        if (!id) {
          failRow(row, 'manager_failed', `Manager（第 ${ref.row.line} 行）沒有匯入`);
          continue;
        }
        managerId = id;
      }

      let account: { participantId: string; userId: string };
      try {
        account = await createParticipantAccount(this.auth, this.db, {
          name: row.name,
          email: row.email,
          managerId,
          permissions: [],
        });
      } catch (error) {
        this.logger.error({ err: error, line: row.line }, 'CSV 匯入建立帳號失敗');
        failRow(row, 'create_failed', '建立帳號時發生錯誤，請稍後再匯入這一行');
        continue;
      }
      createdId.set(row, account.participantId);

      let invitationSent = true;
      try {
        await this.invitations.send(
          { id: account.userId, name: row.name, email: row.email },
          inviter.name,
        );
      } catch (error) {
        invitationSent = false;
        this.logger.error({ err: error, participantId: account.participantId }, '邀請信寄送失敗');
      }
      imported.push({
        line: row.line,
        participantId: account.participantId,
        name: row.name,
        email: row.email,
        managerId,
        invitationSent,
      });
    }

    imported.sort((a, b) => a.line - b.line);
    failed.sort((a, b) => a.line - b.line);
    return { imported, failed };
  }

  /** 解析標題列與每一行的格式；格式錯誤的行直接記為失敗。標題列缺少必要欄位時整份檔案不處理。 */
  private parseRows(
    csv: string,
    fail: (line: number, email: string | null, code: ImportFailureCode, message: string) => void,
  ): Row[] {
    const [header, ...records] = parseCsv(csv);
    if (!header) throw new BadRequestException('CSV 是空的');
    if (header.error !== undefined)
      throw new BadRequestException(`標題列格式錯誤：${header.error}`);

    const columns = new Map<Column, number>();
    header.fields.forEach((raw, index) => {
      const key = raw.toLowerCase().replace(/[\s_\-的]/g, '');
      const column = HEADER_ALIASES[key];
      if (!column) return;
      if (columns.has(column)) throw new BadRequestException(`標題列有重複的欄位「${raw}」`);
      columns.set(column, index);
    });
    const nameAt = columns.get('name');
    const emailAt = columns.get('email');
    if (nameAt === undefined || emailAt === undefined) {
      throw new BadRequestException('標題列需要「姓名」、「email」與「Manager 的 email」三個欄位');
    }
    const managerAt = columns.get('managerEmail');

    const rows: Row[] = [];
    for (const record of records) {
      if (record.error !== undefined) {
        fail(record.line, null, 'invalid_format', record.error);
        continue;
      }
      const cell = (index: number | undefined) =>
        index === undefined ? '' : (record.fields[index] ?? '').trim();
      const email = cell(emailAt).toLowerCase();
      const reportedEmail = email || null;
      if (record.fields.length !== header.fields.length) {
        fail(
          record.line,
          reportedEmail,
          'invalid_format',
          `欄位數量不對：標題列有 ${header.fields.length} 欄，這一行有 ${record.fields.length} 欄`,
        );
        continue;
      }
      const name = cell(nameAt);
      const managerEmail = cell(managerAt).toLowerCase() || null;
      if (!name) {
        fail(record.line, reportedEmail, 'invalid_format', '姓名是空的');
      } else if (name.length > NAME_MAX_LENGTH) {
        fail(record.line, reportedEmail, 'invalid_format', `姓名超過 ${NAME_MAX_LENGTH} 個字`);
      } else if (!emailSchema.safeParse(email).success) {
        fail(record.line, reportedEmail, 'invalid_format', `email 格式錯誤：「${email}」`);
      } else if (managerEmail && !emailSchema.safeParse(managerEmail).success) {
        fail(
          record.line,
          email,
          'invalid_format',
          `Manager 的 email 格式錯誤：「${managerEmail}」`,
        );
      } else {
        rows.push({ line: record.line, name, email, managerEmail });
      }
    }
    return rows;
  }

  /**
   * 這一行的 Manager。檔案中會匯入的行優先，其次是現有的 Participant；
   * 找不到或已停用時記為失敗並回傳 undefined。
   */
  private resolveManager(
    row: Row,
    candidates: Map<string, Row>,
    existing: Map<string, { participantId: string | null; deactivated: boolean }>,
    failedLineByEmail: Map<string | null, number>,
    failRow: (row: Row, code: ImportFailureCode, message: string) => void,
  ): ManagerRef | undefined {
    const email = row.managerEmail;
    if (!email) return { kind: 'none' };
    const inFile = candidates.get(email);
    if (inFile) return { kind: 'row', row: inFile };

    const account = existing.get(email);
    if (account?.participantId) {
      if (account.deactivated) {
        failRow(row, 'manager_deactivated', `Manager（${email}）已停用`);
        return undefined;
      }
      return { kind: 'existing', id: account.participantId };
    }
    const failedLine = failedLineByEmail.get(email);
    if (failedLine !== undefined) {
      failRow(row, 'manager_failed', `Manager（第 ${failedLine} 行）沒有匯入`);
    } else {
      failRow(row, 'manager_not_found', `找不到 Manager（${email}）`);
    }
    return undefined;
  }

  /** 現有帳號，以小寫 email 為 key；participantId 為 null 的是沒有對應 Participant 的帳號。 */
  private async existingAccounts() {
    const rows = await this.db
      .select({
        email: authUsers.email,
        participantId: participants.id,
        deactivatedAt: participants.deactivatedAt,
      })
      .from(authUsers)
      .leftJoin(participants, eq(participants.userId, authUsers.id));
    return new Map(
      rows.map((r) => [
        r.email.toLowerCase(),
        { participantId: r.participantId, deactivated: r.deactivatedAt !== null },
      ]),
    );
  }
}
