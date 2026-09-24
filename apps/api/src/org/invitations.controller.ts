import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse } from '@nestjs/swagger';
import { invitationSchema } from '@river/contracts';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { createZodDto } from 'nestjs-zod';
import { InvitationsService } from './invitations.service.js';

class InvitationDto extends createZodDto(invitationSchema) {}

/** 設定密碼頁用：確認邀請連結是否仍有效。設定密碼本身走 Better Auth 的 `POST /api/auth/reset-password`。 */
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get(':token')
  @AllowAnonymous()
  @ApiOkResponse({ type: InvitationDto })
  @ApiNotFoundResponse({ description: '連結不存在、已使用或已過期' })
  async find(@Param('token') token: string): Promise<InvitationDto> {
    const invitation = await this.invitations.find(token);
    if (!invitation) throw new NotFoundException('邀請連結已失效');
    return invitation;
  }
}
