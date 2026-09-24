import { Controller, ForbiddenException, Get, Inject } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { meResponseSchema } from '@river/contracts';
import type { Database } from '@river/db';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { createZodDto } from 'nestjs-zod';
import { findActiveParticipant } from '../auth/active-participant.js';
import { DATABASE } from '../tokens.js';

class MeResponseDto extends createZodDto(meResponseSchema) {}

@Controller('me')
export class MeController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @ApiOkResponse({ type: MeResponseDto })
  async me(@Session() session: UserSession): Promise<MeResponseDto> {
    const me = await findActiveParticipant(this.db, session.user.id);
    if (!me) throw new ForbiddenException('這個帳號不是有效的 Participant');
    return me;
  }
}
