import { randomUUID } from 'node:crypto';
import { Controller, Get, Inject } from '@nestjs/common';
import type { Database } from '@river/db';
import { Client } from '@temporalio/client';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { sql } from 'drizzle-orm';
import { DATABASE, TEMPORAL_CLIENT, TEMPORAL_TASK_QUEUE } from '../tokens.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    @Inject(TEMPORAL_TASK_QUEUE) private readonly taskQueue: string,
  ) {}

  /** 給 Docker / Caddy 的存活檢查：只確認 api 與 Postgres。 */
  @Get()
  @AllowAnonymous()
  async live() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok' as const };
  }

  /** 端對端檢查：api → Temporal → worker → Postgres。需要登入，避免匿名請求大量建立 workflow。 */
  @Get('temporal')
  async temporalRoundTrip() {
    // 以名稱啟動 workflow，api 不直接依賴 worker 的程式碼。
    const status: 'ok' = await this.temporal.workflow.execute('healthCheck', {
      taskQueue: this.taskQueue,
      workflowId: `health-check-${randomUUID()}`,
      workflowExecutionTimeout: '30 seconds',
    });
    return { status };
  }
}
