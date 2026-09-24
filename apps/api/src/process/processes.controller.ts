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
  processListSchema,
  processNameSchema,
  processSchema,
  processVersionSchema,
  publishProcessSchema,
  publishRejectedSchema,
  saveDraftSchema,
} from '@river/contracts';
import { createZodDto } from 'nestjs-zod';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { CurrentParticipant, RequirePermission } from '../auth/require-permission.js';
import { ProcessesService } from './processes.service.js';

class ProcessDto extends createZodDto(processSchema) {}
class ProcessListDto extends createZodDto(processListSchema) {}
class ProcessNameDto extends createZodDto(processNameSchema) {}
class SaveDraftDto extends createZodDto(saveDraftSchema) {}
class PublishProcessDto extends createZodDto(publishProcessSchema) {}
class ProcessVersionDto extends createZodDto(processVersionSchema) {}
class PublishRejectedDto extends createZodDto(publishRejectedSchema) {}

const Id = () => Param('id', new ParseUUIDPipe());

/** 查看給編輯與發佈的人；編輯草稿需要 process.edit，發佈需要 process.publish。 */
@Controller('processes')
export class ProcessesController {
  constructor(private readonly processes: ProcessesService) {}

  @Get()
  @RequirePermission('process.edit', 'process.publish')
  @ApiOkResponse({ type: ProcessListDto })
  list(): Promise<ProcessSummary[]> {
    return this.processes.list();
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
