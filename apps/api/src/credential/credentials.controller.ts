import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import {
  type Credential,
  type CredentialDirectoryEntry,
  createCredentialSchema,
  credentialDirectorySchema,
  credentialListSchema,
  credentialSchema,
  rotateCredentialSchema,
} from '@river/contracts';
import { createZodDto } from 'nestjs-zod';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { CurrentParticipant, RequirePermission } from '../auth/require-permission.js';
import { CredentialsService } from './credentials.service.js';

class CredentialDto extends createZodDto(credentialSchema) {}
class CredentialListDto extends createZodDto(credentialListSchema) {}
class CredentialDirectoryDto extends createZodDto(credentialDirectorySchema) {}
class CreateCredentialDto extends createZodDto(createCredentialSchema) {}
class RotateCredentialDto extends createZodDto(rotateCredentialSchema) {}

const Id = () => Param('id', new ParseUUIDPipe());

/** Credential：秘密只能寫入，任何回應都不含秘密。管理需要 credential.manage（不在任何預設組合中）。 */
@Controller('credentials')
@RequirePermission('credential.manage')
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Get()
  @ApiOkResponse({ type: CredentialListDto })
  list(): Promise<Credential[]> {
    return this.credentials.list();
  }

  /** Designer 在 HTTP 節點挑選 Credential 用：只有名稱與送出方式。 */
  @Get('directory')
  @RequirePermission('process.edit', 'process.publish', 'credential.manage')
  @ApiOkResponse({ type: CredentialDirectoryDto })
  directory(): Promise<CredentialDirectoryEntry[]> {
    return this.credentials.directory();
  }

  @Post()
  @ApiCreatedResponse({ type: CredentialDto })
  @ApiConflictResponse({ description: '已經有同名的 Credential' })
  create(
    @Body() body: CreateCredentialDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<Credential> {
    return this.credentials.create(body, me);
  }

  /** 輪替秘密；下一次呼叫就使用新的秘密，不需要重新發佈 Process。 */
  @Put(':id/secret')
  @ApiOkResponse({ type: CredentialDto })
  @ApiNotFoundResponse({ description: 'Credential 不存在' })
  rotate(
    @Id() id: string,
    @Body() body: RotateCredentialDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<Credential> {
    return this.credentials.rotate(id, body, me);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNotFoundResponse({ description: 'Credential 不存在' })
  remove(@Id() id: string): Promise<void> {
    return this.credentials.remove(id);
  }
}
