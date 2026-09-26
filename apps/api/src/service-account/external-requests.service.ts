import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  ExternalRequest,
  ExternalStartRequestCommand,
  RequestSummary,
} from '@river/contracts';
import { authUsers, type Database, participants } from '@river/db';
import { and, eq, isNull } from 'drizzle-orm';
import { RequestReads } from '../request/request-reads.js';
import { RequestsService } from '../request/requests.service.js';
import { DATABASE } from '../tokens.js';
import {
  type AuthenticatedServiceAccount,
  ServiceAccountsService,
} from './service-accounts.service.js';

/** 外部 API：Service Account 發起 Request、查詢自己發起的 Request 的狀態。 */
@Injectable()
export class ExternalRequestsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly serviceAccounts: ServiceAccountsService,
    private readonly requests: RequestsService,
    private readonly reads: RequestReads,
  ) {}

  /**
   * 只能發起被授權的 Process（不存在的 Process 也一樣回 403，不透露有哪些 Process）。
   * 帶 on_behalf_of 時那位 Participant 就是發起人：指派給 Manager 的步驟交給他的 Manager，
   * Request 出現在他的「我的申請」；不檢查他是否在 Initiator Role 裡，授權範圍由 Administrator 在 Service Account 上設定。
   * 沒有帶時發起人是 Service Account 本身，它沒有 Manager，指派給 Manager 的步驟改派給 Fallback Role。
   */
  async start(
    input: ExternalStartRequestCommand,
    account: AuthenticatedServiceAccount,
  ): Promise<ExternalRequest> {
    if (!(await this.serviceAccounts.canStart(account.id, input.processId)))
      throw new ForbiddenException('這個 Service Account 沒有被授權發起這個 Process');
    const current = await this.requests.currentVersion(input.processId);
    const initiatorId = input.on_behalf_of
      ? await this.participantByEmail(input.on_behalf_of)
      : null;
    const id = await this.requests.launch(current, input, {
      initiatorId,
      serviceAccountId: account.id,
    });
    return this.find(id, account);
  }

  async list(account: AuthenticatedServiceAccount): Promise<ExternalRequest[]> {
    return (await this.reads.startedBy(account.id)).map(toExternal);
  }

  /** 只查得到自己發起的；其他 Request（包括不存在的）一律回 404。 */
  async find(id: string, account: AuthenticatedServiceAccount): Promise<ExternalRequest> {
    const summary = await this.reads.summary(id);
    if (!summary || summary.serviceAccount?.id !== account.id)
      throw new NotFoundException('找不到這筆 Request');
    return toExternal(summary);
  }

  private async participantByEmail(email: string): Promise<string> {
    const [row] = await this.db
      .select({ id: participants.id })
      .from(participants)
      .innerJoin(authUsers, eq(authUsers.id, participants.userId))
      .where(and(eq(authUsers.email, email), isNull(participants.deactivatedAt)));
    if (!row)
      throw new UnprocessableEntityException(`on_behalf_of 找不到有效的 Participant：${email}`);
    return row.id;
  }
}

/** 外部系統只拿得到狀態，不含 Form 資料與處理人。 */
function toExternal(r: RequestSummary): ExternalRequest {
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    status: r.status,
    process: r.process,
    initiator: r.initiator,
    pendingSteps: r.openTasks.map((t) => t.nodeName),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
