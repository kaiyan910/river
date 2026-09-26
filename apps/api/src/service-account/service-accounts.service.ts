import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { IssuedApiKey, ServiceAccount, ServiceAccountProcessOption } from '@river/contracts';
import {
  type Database,
  processes,
  processVersions,
  serviceAccountProcesses,
  serviceAccounts,
} from '@river/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DATABASE } from '../tokens.js';
import { generateApiKey, hashApiKey } from './api-key.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** 通過 API key 驗證的 Service Account。 */
export interface AuthenticatedServiceAccount {
  id: string;
  name: string;
}

/** Administrator 管理 Service Account：建立、限定可發起的 Process、發放與輪替 API key。 */
@Injectable()
export class ServiceAccountsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(): Promise<ServiceAccount[]> {
    return this.read();
  }

  /** 可以授權的 Process：至少發佈過一個版本的，依名稱排序。 */
  processOptions(): Promise<ServiceAccountProcessOption[]> {
    const published = this.db.select({ id: processVersions.processId }).from(processVersions);
    return this.db
      .select({ id: processes.id, name: processes.name })
      .from(processes)
      .where(inArray(processes.id, published))
      .orderBy(asc(processes.name));
  }

  /** 建立 Service Account 並發放第一把 API key；明文只在這次回應出現。 */
  async create(name: string, processIds: string[]): Promise<IssuedApiKey> {
    const key = generateApiKey();
    const id = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(serviceAccounts)
        .values({ name, apiKeyHash: key.hash, apiKeyPrefix: key.prefix })
        .onConflictDoNothing({ target: serviceAccounts.name })
        .returning({ id: serviceAccounts.id });
      if (!created) throw new ConflictException('已經有同名的 Service Account');
      await this.replaceProcesses(tx, created.id, processIds);
      return created.id;
    });
    return { serviceAccount: await this.get(id), apiKey: key.plaintext };
  }

  /** 以整份清單取代可以發起的 Process，立刻生效。 */
  async setProcesses(id: string, processIds: string[]): Promise<ServiceAccount> {
    await this.get(id);
    await this.db.transaction((tx) => this.replaceProcesses(tx, id, processIds));
    return this.get(id);
  }

  /** 輪替 API key：換掉 hash，舊的 key 立即失效；新的明文只在這次回應出現。 */
  async rotateKey(id: string): Promise<IssuedApiKey> {
    const key = generateApiKey();
    const [updated] = await this.db
      .update(serviceAccounts)
      .set({ apiKeyHash: key.hash, apiKeyPrefix: key.prefix, apiKeyIssuedAt: new Date() })
      .where(eq(serviceAccounts.id, id))
      .returning({ id: serviceAccounts.id });
    if (!updated) throw new NotFoundException('找不到這個 Service Account');
    return { serviceAccount: await this.get(id), apiKey: key.plaintext };
  }

  /** 以明文 key 找出 Service Account；找不到時回傳 undefined。 */
  async authenticate(apiKey: string): Promise<AuthenticatedServiceAccount | undefined> {
    const [row] = await this.db
      .select({ id: serviceAccounts.id, name: serviceAccounts.name })
      .from(serviceAccounts)
      .where(eq(serviceAccounts.apiKeyHash, hashApiKey(apiKey)));
    return row;
  }

  /** 這個 Service Account 是否被授權發起這個 Process。 */
  async canStart(serviceAccountId: string, processId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ processId: serviceAccountProcesses.processId })
      .from(serviceAccountProcesses)
      .where(
        and(
          eq(serviceAccountProcesses.serviceAccountId, serviceAccountId),
          eq(serviceAccountProcesses.processId, processId),
        ),
      );
    return !!row;
  }

  private async get(id: string): Promise<ServiceAccount> {
    const [account] = await this.read(id);
    if (!account) throw new NotFoundException('找不到這個 Service Account');
    return account;
  }

  private async read(id?: string): Promise<ServiceAccount[]> {
    const accounts = await this.db
      .select({
        id: serviceAccounts.id,
        name: serviceAccounts.name,
        prefix: serviceAccounts.apiKeyPrefix,
        issuedAt: serviceAccounts.apiKeyIssuedAt,
        createdAt: serviceAccounts.createdAt,
      })
      .from(serviceAccounts)
      .where(id ? eq(serviceAccounts.id, id) : undefined)
      .orderBy(asc(serviceAccounts.name));
    if (accounts.length === 0) return [];
    const scopes = await this.db
      .select({
        serviceAccountId: serviceAccountProcesses.serviceAccountId,
        id: processes.id,
        name: processes.name,
      })
      .from(serviceAccountProcesses)
      .innerJoin(processes, eq(processes.id, serviceAccountProcesses.processId))
      .where(
        inArray(
          serviceAccountProcesses.serviceAccountId,
          accounts.map((a) => a.id),
        ),
      )
      .orderBy(asc(processes.name));
    return accounts.map((a) => ({
      id: a.id,
      name: a.name,
      processes: scopes
        .filter((s) => s.serviceAccountId === a.id)
        .map(({ id, name }) => ({ id, name })),
      apiKey: { prefix: a.prefix, issuedAt: a.issuedAt.toISOString() },
      createdAt: a.createdAt.toISOString(),
    }));
  }

  private async replaceProcesses(tx: Tx, id: string, processIds: string[]): Promise<void> {
    const unique = [...new Set(processIds)];
    if (unique.length > 0) {
      const published = tx.select({ id: processVersions.processId }).from(processVersions);
      const found = await tx
        .select({ id: processes.id })
        .from(processes)
        .where(and(inArray(processes.id, unique), inArray(processes.id, published)));
      if (found.length !== unique.length)
        throw new BadRequestException('只能授權已經發佈的 Process');
    }
    await tx
      .delete(serviceAccountProcesses)
      .where(eq(serviceAccountProcesses.serviceAccountId, id));
    if (unique.length > 0)
      await tx
        .insert(serviceAccountProcesses)
        .values(unique.map((processId) => ({ serviceAccountId: id, processId })));
  }
}
