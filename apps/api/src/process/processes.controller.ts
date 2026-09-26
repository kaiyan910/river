import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  type ProcessSummary,
  processAccessSchema,
  processListSchema,
  processNameSchema,
  processSchema,
  processVersionSchema,
  publishProcessSchema,
  publishRejectedSchema,
  type StartableProcess,
  saveDraftSchema,
  setProcessScheduleSchema,
  startableProcessListSchema,
} from '@river/contracts';
import { createZodDto } from 'nestjs-zod';
import type { ActiveParticipant } from '../auth/active-participant.js';
import {
  CurrentParticipant,
  RequireParticipant,
  RequirePermission,
} from '../auth/require-permission.js';
import { ProcessScheduleService } from './process-schedule.service.js';
import { ProcessesService } from './processes.service.js';

class ProcessDto extends createZodDto(processSchema) {}
class ProcessListDto extends createZodDto(processListSchema) {}
class ProcessNameDto extends createZodDto(processNameSchema) {}
class SaveDraftDto extends createZodDto(saveDraftSchema) {}
class PublishProcessDto extends createZodDto(publishProcessSchema) {}
class ProcessVersionDto extends createZodDto(processVersionSchema) {}
class PublishRejectedDto extends createZodDto(publishRejectedSchema) {}
class StartableProcessListDto extends createZodDto(startableProcessListSchema) {}
class ProcessAccessDto extends createZodDto(processAccessSchema) {}
class SetProcessScheduleDto extends createZodDto(setProcessScheduleSchema) {}

const Id = () => Param('id', new ParseUUIDPipe());

/** 查看給編輯與發佈的人；編輯草稿需要 process.edit，發佈需要 process.publish。 */
@Controller('processes')
export class ProcessesController {
  constructor(
    private readonly processes: ProcessesService,
    private readonly schedules: ProcessScheduleService,
  ) {}

  @Get()
  @RequirePermission('process.edit', 'process.publish')
  @ApiOkResponse({ type: ProcessListDto })
  list(): Promise<ProcessSummary[]> {
    return this.processes.list();
  }

  /** 入口網站：自己可以發起的已發佈 Process（沒有設定 Initiator Role，或自己是其成員）。 */
  @Get('startable')
  @RequireParticipant()
  @ApiOkResponse({ type: StartableProcessListDto })
  startable(@CurrentParticipant() me: ActiveParticipant): Promise<StartableProcess[]> {
    return this.processes.startable(me);
  }

  @Get(':id')
  @RequirePermission('process.edit', 'process.publish')
  @ApiOkResponse({ type: ProcessDto })
  get(@Id() id: string): Promise<ProcessDto> {
    return this.processes.get(id);
  }

  @Post()
  @RequirePermission('process.edit')
  @ApiCreatedResponse({ type: ProcessDto })
  create(
    @Body() body: ProcessNameDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<ProcessDto> {
    return this.processes.create(body.name, me);
  }

  @Patch(':id')
  @RequirePermission('process.edit')
  @ApiOkResponse({ type: ProcessDto })
  rename(@Id() id: string, @Body() body: ProcessNameDto): Promise<ProcessDto> {
    return this.processes.rename(id, body.name);
  }

  @Post(':id/draft')
  @RequirePermission('process.edit')
  @ApiCreatedResponse({ type: ProcessDto, description: '從目前版本建立的新草稿' })
  @ApiConflictResponse({ description: '已經有草稿，或還沒發佈過' })
  createDraft(@Id() id: string, @CurrentParticipant() me: ActiveParticipant): Promise<ProcessDto> {
    return this.processes.createDraft(id, me);
  }

  @Put(':id/draft')
  @RequirePermission('process.edit')
  @ApiOkResponse({ type: ProcessDto })
  saveDraft(
    @Id() id: string,
    @Body() body: SaveDraftDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<ProcessDto> {
    return this.processes.saveDraft(id, body.dsl, me);
  }

  @Delete(':id/draft')
  @HttpCode(204)
  @RequirePermission('process.edit')
  @ApiConflictResponse({ description: '還沒發佈過的 Process 沒有可以回去的版本' })
  discardDraft(@Id() id: string): Promise<void> {
    return this.processes.discardDraft(id);
  }

  /** Initiator Role 與 Observer Role 不需要發佈就立刻生效，所以和發佈一樣需要 process.publish。 */
  @Put(':id/access')
  @RequirePermission('process.publish')
  @ApiOkResponse({ type: ProcessDto })
  @ApiUnprocessableEntityResponse({ description: '有 Role 不存在' })
  setAccess(@Id() id: string, @Body() body: ProcessAccessDto): Promise<ProcessDto> {
    return this.processes.setAccess(id, body);
  }

  /** 排程發起：和 Initiator Role 一樣設定在 Process 上、立刻生效，所以需要 process.publish。 */
  @Put(':id/schedule')
  @RequirePermission('process.publish')
  @ApiOkResponse({ type: ProcessDto })
  @ApiConflictResponse({ description: '還沒發佈過的 Process 不能設定排程' })
  @ApiUnprocessableEntityResponse({
    description: 'cron 不合法，或發起人無效、不能發起這個 Process',
  })
  async setSchedule(
    @Id() id: string,
    @Body() body: SetProcessScheduleDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<ProcessDto> {
    await this.schedules.set(id, body, me);
    return this.processes.get(id);
  }

  @Delete(':id/schedule')
  @RequirePermission('process.publish')
  @ApiOkResponse({ type: ProcessDto })
  async removeSchedule(@Id() id: string): Promise<ProcessDto> {
    await this.schedules.remove(id);
    return this.processes.get(id);
  }

  @Post(':id/versions')
  @RequirePermission('process.publish')
  @ApiCreatedResponse({ type: ProcessVersionDto })
  @ApiConflictResponse({ description: '沒有草稿可以發佈' })
  @ApiUnprocessableEntityResponse({
    type: PublishRejectedDto,
    description: '草稿沒有通過發佈前檢查',
  })
  publish(
    @Id() id: string,
    @Body() body: PublishProcessDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<ProcessVersionDto> {
    return this.processes.publish(id, body.note, me);
  }
}
