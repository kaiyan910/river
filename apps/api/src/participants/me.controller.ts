import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { meResponseSchema } from '@river/contracts';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { createZodDto } from 'nestjs-zod';
import { ParticipantsService } from './participants.service.js';

class MeResponseDto extends createZodDto(meResponseSchema) {}

@Controller('me')
export class MeController {
  constructor(private readonly participants: ParticipantsService) {}

  @Get()
  @ApiOkResponse({ type: MeResponseDto })
  async me(@Session() session: UserSession): Promise<MeResponseDto> {
    const me = await this.participants.findActiveByUserId(session.user.id);
    if (!me) throw new ForbiddenException('這個帳號不是有效的 Participant');
    return me;
  }
}
