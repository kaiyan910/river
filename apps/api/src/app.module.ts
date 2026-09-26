import type { IncomingMessage } from 'node:http';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import type { Database } from '@river/db';
import type { EmailSender } from '@river/email';
import { createLogger, type LoggerEnv } from '@river/logger';
import type { Client } from '@temporalio/client';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { AttachmentModule } from './attachment/attachment.module.js';
import type { AttachmentStorage } from './attachment/attachment-storage.js';
import type { Auth } from './auth/create-auth.js';
import { HealthController } from './health/health.controller.js';
import { OrgModule } from './org/org.module.js';
import { ProcessModule } from './process/process.module.js';
import { RequestModule } from './request/request.module.js';
import {
  APP_URL,
  ATTACHMENT_STORAGE,
  AUTH,
  DATABASE,
  EMAIL_SENDER,
  TEMPORAL_CLIENT,
  TEMPORAL_TASK_QUEUE,
} from './tokens.js';

/** App 的外部依賴。main.ts 從環境變數建立，測試 harness 從 Testcontainers 與 TestWorkflowEnvironment 建立。 */
export interface AppDeps {
  db: Database;
  auth: Auth;
  emailSender: EmailSender;
  /** 瀏覽器看到的網址，例如 https://river.example.com；邀請信的連結以它為準。 */
  appUrl: string;
  /** 附件的 object storage（Garage）；API 只發 presigned URL 與確認檔案已上傳。 */
  storage: AttachmentStorage;
  temporal: Client;
  taskQueue: string;
  log: LoggerEnv;
}

@Global()
@Module({})
class InfrastructureModule {
  static register(deps: AppDeps): DynamicModule {
    return {
      module: InfrastructureModule,
      providers: [
        { provide: DATABASE, useValue: deps.db },
        { provide: AUTH, useValue: deps.auth },
        { provide: EMAIL_SENDER, useValue: deps.emailSender },
        { provide: APP_URL, useValue: deps.appUrl },
        { provide: ATTACHMENT_STORAGE, useValue: deps.storage },
        { provide: TEMPORAL_CLIENT, useValue: deps.temporal },
        { provide: TEMPORAL_TASK_QUEUE, useValue: deps.taskQueue },
      ],
      exports: [
        DATABASE,
        AUTH,
        EMAIL_SENDER,
        APP_URL,
        ATTACHMENT_STORAGE,
        TEMPORAL_CLIENT,
        TEMPORAL_TASK_QUEUE,
      ],
    };
  }
}

@Module({})
export class AppModule {
  static register(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      imports: [
        InfrastructureModule.register(deps),
        LoggerModule.forRoot({
          pinoHttp: {
            logger: createLogger(deps.log, 'api'),
            customSuccessMessage: (req, res, responseTime) =>
              `${req.method} ${requestUrl(req)} ${res.statusCode} ${responseTime}ms`,
            customErrorMessage: (req, res, error) =>
              `${req.method} ${requestUrl(req)} ${res.statusCode} ${error.message}`,
          },
        }),
        // CSV 匯入整份檔案放在 JSON body 裡，預設的 100kb 不夠。
        AuthModule.forRoot({ auth: deps.auth, bodyParser: { json: { limit: '2mb' } } }),
        OrgModule,
        ProcessModule,
        RequestModule,
        AttachmentModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
    };
  }
}

/** Express 進到子路由後會改寫 req.url，originalUrl 才是完整路徑。 */
function requestUrl(req: IncomingMessage): string {
  return (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '';
}
