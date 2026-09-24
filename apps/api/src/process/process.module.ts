import { Module } from '@nestjs/common';
import { ProcessesController } from './processes.controller.js';
import { ProcessesService } from './processes.service.js';

/** 流程定義：Process、草稿、發佈與 Process Version。 */
@Module({
  controllers: [ProcessesController],
  providers: [ProcessesService],
})
export class ProcessModule {}
