import { Module } from '@nestjs/common';
import { RequestModule } from '../request/request.module.js';
import { ExternalProcessesController } from './external-processes.controller.js';
import { ExternalProcessesService } from './external-processes.service.js';
import { ExternalRequestsController } from './external-requests.controller.js';
import { ExternalRequestsService } from './external-requests.service.js';
import { ServiceAccountGuard } from './require-service-account.js';
import { ServiceAccountsController } from './service-accounts.controller.js';
import { ServiceAccountsService } from './service-accounts.service.js';

/** Administrator 管理 Service Account：建立、授權範圍、發放與輪替 API key。 */
@Module({
  controllers: [ServiceAccountsController],
  providers: [ServiceAccountsService, ServiceAccountGuard],
  exports: [ServiceAccountsService, ServiceAccountGuard],
})
export class ServiceAccountModule {}

/**
 * 外部 API（`/api/external/*`）：Service Account 以 Bearer API key 呼叫，與 session 驗證的 UI API 分開。
 * OpenAPI 文件只涵蓋這個 module（見 create-app.ts）。
 */
@Module({
  imports: [ServiceAccountModule, RequestModule],
  controllers: [ExternalProcessesController, ExternalRequestsController],
  providers: [ExternalProcessesService, ExternalRequestsService],
})
export class ExternalApiModule {}
