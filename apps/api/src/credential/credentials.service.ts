import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateCredentialInput,
  Credential,
  CredentialDirectoryEntry,
  RotateCredentialInput,
} from '@river/contracts';
import { type CredentialCipher, credentials, type Database } from '@river/db';
import { asc, eq, sql } from 'drizzle-orm';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { lookupNames } from '../process/processes.service.js';
import { CREDENTIAL_CIPHER, DATABASE } from '../tokens.js';

type CredentialRow = typeof credentials.$inferSelect;

/**
 * Credential：秘密只能寫入。存進資料庫前先加密（見 CredentialCipher），任何回傳值都不含秘密或密文；
 * 解密只發生在 worker 的 httpRequest activity。
 */
@Injectable()
export class CredentialsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CREDENTIAL_CIPHER) private readonly cipher: CredentialCipher,
  ) {}

  async list(): Promise<Credential[]> {
    const rows = await this.db.select().from(credentials).orderBy(asc(credentials.name));
    const names = await lookupNames(
      this.db,
      rows.flatMap((r) => [r.createdBy, r.rotatedBy]),
    );
    return rows.map((r) => toCredential(r, names.people));
  }

  /** HTTP 節點挑選 Credential 用：只有名稱與送出方式。 */
  directory(): Promise<CredentialDirectoryEntry[]> {
    return this.db
      .select({
        name: credentials.name,
        scheme: credentials.scheme,
        headerName: credentials.headerName,
      })
      .from(credentials)
      .orderBy(asc(credentials.name));
  }

  async create(input: CreateCredentialInput, me: ActiveParticipant): Promise<Credential> {
    const id = randomUUID();
    const [created] = await this.db
      .insert(credentials)
      .values({
        id,
        name: input.name,
        scheme: input.scheme,
        headerName: input.scheme === 'header' ? (input.headerName ?? null) : null,
        secret: this.cipher.encrypt(id, input.secret),
        createdBy: me.id,
        rotatedBy: me.id,
      })
      .onConflictDoNothing({ target: credentials.name })
      .returning({ id: credentials.id });
    if (!created) throw new ConflictException('已經有同名的 Credential');
    return this.get(id);
  }

  /** 輪替秘密：HTTP 節點下一次呼叫就用新的秘密，不需要重新發佈 Process。 */
  async rotate(
    id: string,
    input: RotateCredentialInput,
    me: ActiveParticipant,
  ): Promise<Credential> {
    const [rotated] = await this.db
      .update(credentials)
      .set({
        secret: this.cipher.encrypt(id, input.secret),
        rotatedBy: me.id,
        rotatedAt: sql`now()`,
      })
      .where(eq(credentials.id, id))
      .returning({ id: credentials.id });
    if (!rotated) throw new NotFoundException('找不到這個 Credential');
    return this.get(id);
  }

  /**
   * 刪除：已發佈的 Process 仍然以名稱引用它時，走到那個 HTTP 節點會失敗並暫停 Request，
   * 重新建立同名的 Credential 後由 Administrator 重試即可。
   */
  async remove(id: string): Promise<void> {
    const [deleted] = await this.db
      .delete(credentials)
      .where(eq(credentials.id, id))
      .returning({ id: credentials.id });
    if (!deleted) throw new NotFoundException('找不到這個 Credential');
  }

  private async get(id: string): Promise<Credential> {
    const found = (await this.list()).find((c) => c.id === id);
    if (!found) throw new NotFoundException('找不到這個 Credential');
    return found;
  }
}

function toCredential(r: CredentialRow, people: Map<string, string>): Credential {
  return {
    id: r.id,
    name: r.name,
    scheme: r.scheme,
    headerName: r.headerName,
    createdBy: { id: r.createdBy, name: people.get(r.createdBy) ?? '' },
    createdAt: r.createdAt.toISOString(),
    rotatedBy: { id: r.rotatedBy, name: people.get(r.rotatedBy) ?? '' },
    rotatedAt: r.rotatedAt.toISOString(),
  };
}
