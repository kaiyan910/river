import { Module } from '@nestjs/common';
import { RequestReads } from './request-reads.js';
import { RequestsController, TasksController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';
import { TasksService } from './tasks.service.js';

/** Request 與 Task：發起、「我的申請」、「我的待辦」、完成 Task 與時間軸。 */
@Module({
  controllers: [RequestsController, TasksController],
  providers: [RequestReads, RequestsService, TasksService],
})
export class RequestModule {}
