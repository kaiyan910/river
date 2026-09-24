import { Module } from '@nestjs/common';
import { MeController } from './me.controller.js';
import { ParticipantsService } from './participants.service.js';

@Module({
  controllers: [MeController],
  providers: [ParticipantsService],
})
export class ParticipantsModule {}
