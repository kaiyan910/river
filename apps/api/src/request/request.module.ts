import { Module } from '@nestjs/common';
import { AttachmentModule } from '../attachment/attachment.module.js';
import { RequestReads } from './request-reads.js';
import { RequestsController, TasksController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';
import { TasksService } from './tasks.service.js';

/** Request 與 Task：發起、「我的申請」、「我的待辦」、完成 Task 與時間軸。 */
@Module({
  imports: [AttachmentModule],
  controllers: [RequestsController, TasksController],
  providers: [RequestReads, RequestsService, TasksService],
  exports: [RequestReads, RequestsService],
})
export class RequestModule {}
