import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { MeController } from './me.controller.js';
import { ParticipantsController } from './participants.controller.js';
import { ParticipantsService } from './participants.service.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';

/** 人員與組織：Participant、Role、Manager、Permission、邀請。 */
@Module({
  controllers: [MeController, ParticipantsController, RolesController, InvitationsController],
  providers: [ParticipantsService, RolesService, InvitationsService],
})
export class OrgModule {}
