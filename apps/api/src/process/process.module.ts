import { Module } from '@nestjs/common';
import { ProcessScheduleService } from './process-schedule.service.js';
import { ProcessesController } from './processes.controller.js';
import { ProcessesService } from './processes.service.js';

/** 流程定義：Process、草稿、發佈、Process Version 與排程發起的設定。 */
@Module({
  controllers: [ProcessesController],
  providers: [ProcessesService, ProcessScheduleService],
})
export class ProcessModule {}
