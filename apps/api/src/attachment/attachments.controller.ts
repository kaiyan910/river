import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse } from '@nestjs/swagger';
import {
  type AttachmentDownload,
  type AttachmentUpload,
  attachmentDownloadSchema,
  attachmentUploadSchema,
  createAttachmentSchema,
} from '@river/contracts';
import { createZodDto } from 'nestjs-zod';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { CurrentParticipant, RequireParticipant } from '../auth/require-permission.js';
import { AttachmentsService } from './attachments.service.js';

class CreateAttachmentDto extends createZodDto(createAttachmentSchema) {}
class AttachmentUploadDto extends createZodDto(attachmentUploadSchema) {}
class AttachmentDownloadDto extends createZodDto(attachmentDownloadSchema) {}

/** 附件：presigned 上傳 URL 與下載 URL。檔案本身不經過 API。 */
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /** 登記要上傳的檔案，取得 presigned 上傳 URL；送出表單時才依附件欄位的設定檢查。 */
  @Post()
  @RequireParticipant()
  @ApiCreatedResponse({ type: AttachmentUploadDto })
  register(
    @Body() body: CreateAttachmentDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<AttachmentUpload> {
    return this.attachments.register(body, me);
  }

  /** 看得到附件所屬 Request 的人才拿得到下載 URL；還沒送出的附件只有上傳的人。 */
  @Get(':id/download')
  @RequireParticipant()
  @ApiOkResponse({ type: AttachmentDownloadDto })
  @ApiNotFoundResponse({ description: '附件不存在，或看不到它所屬的 Request' })
  download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<AttachmentDownload> {
    return this.attachments.download(id, me);
  }
}
