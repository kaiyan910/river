import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import type { Database } from '@river/db';
import type { EmailSender } from '@river/email';
import type { Client } from '@temporalio/client';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import type { Auth } from './auth/create-auth.js';
import { HealthController } from './health/health.controller.js';
import { OrgModule } from './org/org.module.js';
import { ProcessModule } from './process/process.module.js';
import {
  APP_URL,
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
  temporal: Client;
  taskQueue: string;
  logLevel: string;
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
        { provide: TEMPORAL_CLIENT, useValue: deps.temporal },
        { provide: TEMPORAL_TASK_QUEUE, useValue: deps.taskQueue },
      ],
      exports: [DATABASE, AUTH, EMAIL_SENDER, APP_URL, TEMPORAL_CLIENT, TEMPORAL_TASK_QUEUE],
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
        LoggerModule.forRoot({ pinoHttp: { level: deps.logLevel } }),
        AuthModule.forRoot({ auth: deps.auth }),
        OrgModule,
        ProcessModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
    };
  }
}
