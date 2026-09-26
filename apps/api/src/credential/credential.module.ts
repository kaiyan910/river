import { Module } from '@nestjs/common';
import { CredentialsController } from './credentials.controller.js';
import { CredentialsService } from './credentials.service.js';

/** Credential：建立、輪替與刪除；秘密只能寫入。 */
@Module({
  controllers: [CredentialsController],
  providers: [CredentialsService],
})
export class CredentialModule {}
