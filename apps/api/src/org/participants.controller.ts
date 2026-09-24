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
  participantListSchema,
  participantSchema,
  setPermissionsSchema,
  updateParticipantSchema,
} from '@river/contracts';
import { createZodDto } from 'nestjs-zod';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { CurrentParticipant, RequirePermission } from '../auth/require-permission.js';
import { ParticipantsService } from './participants.service.js';

class ParticipantDto extends createZodDto(participantSchema) {}
class ParticipantListDto extends createZodDto(participantListSchema) {}
class CreateParticipantDto extends createZodDto(createParticipantSchema) {}
class UpdateParticipantDto extends createZodDto(updateParticipantSchema) {}
class SetPermissionsDto extends createZodDto(setPermissionsSchema) {}

const Id = () => Param('id', new ParseUUIDPipe());

@Controller('participants')
export class ParticipantsController {
  constructor(private readonly participants: ParticipantsService) {}

  /** 持有 role.manage 的人也需要人員清單來挑選 Role 成員。 */
  @Get()
  @RequirePermission('user.manage', 'role.manage')
  @ApiOkResponse({ type: ParticipantListDto })
  list(): Promise<ParticipantDto[]> {
    return this.participants.list();
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
}
