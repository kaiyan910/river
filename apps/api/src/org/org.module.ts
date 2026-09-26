import { Module } from '@nestjs/common';
import { RequestModule } from '../request/request.module.js';
import { DeactivationService } from './deactivation.service.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { MeController } from './me.controller.js';
import { ParticipantImportService } from './participant-import.service.js';
import { ParticipantsController } from './participants.controller.js';
import { ParticipantsService } from './participants.service.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';

/** 人員與組織：Participant、Role、Manager、Permission、邀請、CSV 匯入、停用。 */
@Module({
  imports: [RequestModule],
  controllers: [MeController, ParticipantsController, RolesController, InvitationsController],
  providers: [
    ParticipantsService,
    ParticipantImportService,
    RolesService,
    InvitationsService,
    DeactivationService,
  ],
})
export class OrgModule {}
