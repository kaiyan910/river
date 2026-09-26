import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  type ExternalRequest,
  externalRequestListSchema,
  externalRequestSchema,
  externalStartRequestSchema,
} from '@river/contracts';
import { createZodDto } from 'nestjs-zod';
import { ExternalRequestsService } from './external-requests.service.js';
import { CurrentServiceAccount, RequireServiceAccount } from './require-service-account.js';
import type { AuthenticatedServiceAccount } from './service-accounts.service.js';

class ExternalStartRequestDto extends createZodDto(externalStartRequestSchema) {}
class ExternalRequestDto extends createZodDto(externalRequestSchema) {}
class ExternalRequestListDto extends createZodDto(externalRequestListSchema) {}

/** 外部 API：外部系統以 Service Account 的 API key（`Authorization: Bearer <key>`）發起與查詢 Request。 */
@ApiTags('Requests')
@Controller('external/requests')
@RequireServiceAccount()
export class ExternalRequestsController {
  constructor(private readonly requests: ExternalRequestsService) {}

  @Post()
  @ApiOperation({
    summary: '發起 Request',
    description:
      '以 Process 的目前版本發起 Request。只能發起這個 Service Account 被授權的 Process。' +
      '帶 on_behalf_of 時該 Participant 是發起人；沒有帶時發起人是 Service Account，指派給 Manager 的步驟改派給 Fallback Role。',
  })
  @ApiCreatedResponse({ type: ExternalRequestDto })
  @ApiForbiddenResponse({ description: '沒有被授權發起這個 Process' })
  @ApiUnprocessableEntityResponse({
    description: '開始表單的資料沒有通過驗證，或 on_behalf_of 不是有效的 Participant',
  })
  start(
    @Body() body: ExternalStartRequestDto,
    @CurrentServiceAccount() account: AuthenticatedServiceAccount,
  ): Promise<ExternalRequest> {
    return this.requests.start(body, account);
  }

  @Get()
  @ApiOperation({ summary: '列出自己發起的 Request', description: '新的在前。' })
  @ApiOkResponse({ type: ExternalRequestListDto })
  list(@CurrentServiceAccount() account: AuthenticatedServiceAccount): Promise<ExternalRequest[]> {
    return this.requests.list(account);
  }

  @Get(':id')
  @ApiOperation({ summary: '查詢 Request 的狀態', description: '只查得到自己發起的 Request。' })
  @ApiOkResponse({ type: ExternalRequestDto })
  @ApiNotFoundResponse({ description: 'Request 不存在，或不是這個 Service Account 發起的' })
  find(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentServiceAccount() account: AuthenticatedServiceAccount,
  ): Promise<ExternalRequest> {
    return this.requests.find(id, account);
  }
}
