import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import {
  createParticipantSchema,
  type DeactivationImpact,
  type DirectoryEntry,
  deactivationImpactSchema,
  directorySchema,
  type ImportParticipantsResult,
  importParticipantsResultSchema,
  importParticipantsSchema,
  participantListSchema,
  participantSchema,
  setPermissionsSchema,
  updateParticipantSchema,
} from '@river/contracts';
import { createZodDto } from 'nestjs-zod';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { CurrentParticipant, RequirePermission } from '../auth/require-permission.js';
import { DeactivationService } from './deactivation.service.js';
import { ParticipantImportService } from './participant-import.service.js';
import { ParticipantsService } from './participants.service.js';

class ParticipantDto extends createZodDto(participantSchema) {}
class ParticipantListDto extends createZodDto(participantListSchema) {}
class DirectoryDto extends createZodDto(directorySchema) {}
class CreateParticipantDto extends createZodDto(createParticipantSchema) {}
class UpdateParticipantDto extends createZodDto(updateParticipantSchema) {}
class SetPermissionsDto extends createZodDto(setPermissionsSchema) {}
class DeactivationImpactDto extends createZodDto(deactivationImpactSchema) {}
class ImportParticipantsDto extends createZodDto(importParticipantsSchema) {}
class ImportParticipantsResultDto extends createZodDto(importParticipantsResultSchema) {}

const Id = () => Param('id', new ParseUUIDPipe());

@Controller('participants')
export class ParticipantsController {
  constructor(
    private readonly participants: ParticipantsService,
    private readonly deactivation: DeactivationService,
    private readonly importer: ParticipantImportService,
  ) {}

  /** 持有 role.manage 的人也需要人員清單來挑選 Role 成員。 */
  @Get()
  @RequirePermission('user.manage', 'role.manage')
  @ApiOkResponse({ type: ParticipantListDto })
  list(): Promise<ParticipantDto[]> {
    return this.participants.list();
  }

  /** 挑選人員用的精簡清單；Designer 指派審批人、Administrator Reassign Task 時需要。 */
  @Get('directory')
  @RequirePermission(
    'process.edit',
    'process.publish',
    'user.manage',
    'role.manage',
    'task.reassign',
  )
  @ApiOkResponse({ type: DirectoryDto })
  directory(): Promise<DirectoryEntry[]> {
    return this.participants.directory();
  }

  @Post()
  @RequirePermission('user.manage')
  @ApiCreatedResponse({ type: ParticipantDto })
  create(
    @Body() body: CreateParticipantDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<ParticipantDto> {
    return this.participants.create(body, me);
  }

  /**
   * 以 CSV 匯入 Participant 與 Manager：有錯誤的行不匯入並列出行號與原因，其他行照常匯入並寄出邀請信。
   * 標題列缺少必要欄位時回 400，不匯入任何人。
   */
  @Post('import')
  @HttpCode(200)
  @RequirePermission('user.manage')
  @ApiOkResponse({ type: ImportParticipantsResultDto })
  import(
    @Body() body: ImportParticipantsDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<ImportParticipantsResult> {
    return this.importer.import(body.csv, me);
  }

  @Patch(':id')
  @RequirePermission('user.manage')
  @ApiOkResponse({ type: ParticipantDto })
  update(@Id() id: string, @Body() body: UpdateParticipantDto): Promise<ParticipantDto> {
    return this.participants.update(id, body);
  }

  @Put(':id/permissions')
  @RequirePermission('user.manage')
  @ApiOkResponse({ type: ParticipantDto })
  setPermissions(
    @Id() id: string,
    @Body() body: SetPermissionsDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<ParticipantDto> {
    return this.participants.setPermissions(id, body, me);
  }

  /** 重寄邀請信，先前的連結會失效。 */
  @Post(':id/invitation')
  @HttpCode(204)
  @RequirePermission('user.manage')
  resendInvitation(@Id() id: string, @CurrentParticipant() me: ActiveParticipant): Promise<void> {
    return this.participants.resendInvitation(id, me);
  }

  /** 停用前預覽影響範圍：直接指派給此人的 open Task，以及以此人為 Manager 的 Participant。 */
  @Get(':id/deactivation-impact')
  @RequirePermission('user.manage')
  @ApiOkResponse({ type: DeactivationImpactDto })
  deactivationImpact(@Id() id: string): Promise<DeactivationImpact> {
    return this.deactivation.impact(id);
  }

  /** 停用帳號：session 立即失效，資料一律不刪除。 */
  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('user.manage')
  @ApiOkResponse({ type: ParticipantDto })
  deactivate(
    @Id() id: string,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<ParticipantDto> {
    return this.deactivation.deactivate(id, me);
  }
}
