import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type ExternalProcess,
  type ExternalProcessDetail,
  externalProcessDetailSchema,
  externalProcessListSchema,
} from '@river/contracts';
import { createZodDto } from 'nestjs-zod';
import { ExternalProcessesService } from './external-processes.service.js';
import { CurrentServiceAccount, RequireServiceAccount } from './require-service-account.js';
import type { AuthenticatedServiceAccount } from './service-accounts.service.js';

class ExternalProcessListDto extends createZodDto(externalProcessListSchema) {}
class ExternalProcessDetailDto extends createZodDto(externalProcessDetailSchema) {}

/** 外部 API：外部系統查詢自己的 Service Account 可以發起哪些 Process，以及開始表單要填什麼。 */
@ApiTags('Processes')
@Controller('external/processes')
@RequireServiceAccount()
export class ExternalProcessesController {
  constructor(private readonly processes: ExternalProcessesService) {}

  @Get()
  @ApiOperation({
    summary: '列出可以發起的 Process',
    description: '只列出這個 Service Account 被授權發起的 Process，依名稱排序。',
  })
  @ApiOkResponse({ type: ExternalProcessListDto })
  list(@CurrentServiceAccount() account: AuthenticatedServiceAccount): Promise<ExternalProcess[]> {
    return this.processes.list(account);
  }

  @Get(':id')
  @ApiOperation({
    summary: '查詢 Process 的開始表單',
    description: '回傳目前 Process Version 的開始表單欄位定義；發起 Request 時的 data 依它驗證。',
  })
  @ApiOkResponse({ type: ExternalProcessDetailDto })
  @ApiNotFoundResponse({ description: 'Process 不存在，或這個 Service Account 沒有被授權發起' })
  find(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentServiceAccount() account: AuthenticatedServiceAccount,
  ): Promise<ExternalProcessDetail> {
    return this.processes.find(id, account);
  }
}
