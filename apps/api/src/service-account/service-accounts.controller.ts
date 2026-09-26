import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiConflictResponse, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import {
  createServiceAccountSchema,
  type IssuedApiKey,
  issuedApiKeySchema,
  type ServiceAccount,
  type ServiceAccountProcessOption,
  serviceAccountListSchema,
  serviceAccountProcessOptionsSchema,
  serviceAccountSchema,
  setServiceAccountProcessesSchema,
} from '@river/contracts';
import { createZodDto } from 'nestjs-zod';
import { RequirePermission } from '../auth/require-permission.js';
import { ServiceAccountsService } from './service-accounts.service.js';

class ServiceAccountDto extends createZodDto(serviceAccountSchema) {}
class ServiceAccountListDto extends createZodDto(serviceAccountListSchema) {}
class CreateServiceAccountDto extends createZodDto(createServiceAccountSchema) {}
class SetServiceAccountProcessesDto extends createZodDto(setServiceAccountProcessesSchema) {}
class IssuedApiKeyDto extends createZodDto(issuedApiKeySchema) {}
class ServiceAccountProcessOptionsDto extends createZodDto(serviceAccountProcessOptionsSchema) {}

const Id = () => Param('id', new ParseUUIDPipe());

/** Administrator 後台：Service Account 的建立、授權範圍與 API key。 */
@Controller('service-accounts')
@RequirePermission('service_account.manage')
export class ServiceAccountsController {
  constructor(private readonly serviceAccounts: ServiceAccountsService) {}

  @Get()
  @ApiOkResponse({ type: ServiceAccountListDto })
  list(): Promise<ServiceAccount[]> {
    return this.serviceAccounts.list();
  }

  /** 可以授權給 Service Account 的 Process（發佈過的）。 */
  @Get('process-options')
  @ApiOkResponse({ type: ServiceAccountProcessOptionsDto })
  processOptions(): Promise<ServiceAccountProcessOption[]> {
    return this.serviceAccounts.processOptions();
  }

  /** 建立 Service Account 並發放 API key；明文只在這次回應出現。 */
  @Post()
  @ApiCreatedResponse({ type: IssuedApiKeyDto })
  @ApiConflictResponse({ description: '已經有同名的 Service Account' })
  create(@Body() body: CreateServiceAccountDto): Promise<IssuedApiKey> {
    return this.serviceAccounts.create(body.name, body.processIds);
  }

  @Put(':id/processes')
  @ApiOkResponse({ type: ServiceAccountDto })
  setProcesses(
    @Id() id: string,
    @Body() body: SetServiceAccountProcessesDto,
  ): Promise<ServiceAccount> {
    return this.serviceAccounts.setProcesses(id, body.processIds);
  }

  /** 輪替 API key：舊的 key 立即失效，新的明文只在這次回應出現。 */
  @Post(':id/api-key')
  @ApiCreatedResponse({ type: IssuedApiKeyDto })
  rotateKey(@Id() id: string): Promise<IssuedApiKey> {
    return this.serviceAccounts.rotateKey(id);
  }
}
