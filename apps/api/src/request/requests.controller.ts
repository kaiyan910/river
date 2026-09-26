import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import {
  cancelRequestSchema,
  completeTaskSchema,
  type MyTask,
  myTaskListSchema,
  myTaskSchema,
  myTasksQuerySchema,
  pendingReassignListSchema,
  type RequestDetail,
  type RequestSummary,
  reassignTaskSchema,
  requestDetailSchema,
  requestSummaryListSchema,
  requestSummarySchema,
  resubmitRequestSchema,
  startRequestSchema,
  withdrawRequestSchema,
} from '@river/contracts';
import { createZodDto } from 'nestjs-zod';
import type { ActiveParticipant } from '../auth/active-participant.js';
import {
  CurrentParticipant,
  RequireParticipant,
  RequirePermission,
} from '../auth/require-permission.js';
import { RequestsService } from './requests.service.js';
import { TasksService } from './tasks.service.js';

class StartRequestDto extends createZodDto(startRequestSchema) {}
class RequestDetailDto extends createZodDto(requestDetailSchema) {}
class RequestSummaryListDto extends createZodDto(requestSummaryListSchema) {}
class MyTaskListDto extends createZodDto(myTaskListSchema) {}
class MyTasksQueryDto extends createZodDto(myTasksQuerySchema) {}
class CompleteTaskDto extends createZodDto(completeTaskSchema) {}
class ResubmitRequestDto extends createZodDto(resubmitRequestSchema) {}
class WithdrawRequestDto extends createZodDto(withdrawRequestSchema) {}
class CancelRequestDto extends createZodDto(cancelRequestSchema) {}
class RequestSummaryDto extends createZodDto(requestSummarySchema) {}
class ReassignTaskDto extends createZodDto(reassignTaskSchema) {}
class MyTaskDto extends createZodDto(myTaskSchema) {}
class PendingReassignListDto extends createZodDto(pendingReassignListSchema) {}

const Id = () => Param('id', new ParseUUIDPipe());

/** 入口網站的 Request：發起、「我的申請」、明細與時間軸、重新送出與 Withdraw；以及 Administrator 的 Cancel。 */
@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Post()
  @RequireParticipant()
  @ApiCreatedResponse({ type: RequestDetailDto })
  @ApiNotFoundResponse({ description: 'Process 不存在或還沒發佈' })
  @ApiForbiddenResponse({ description: '不在這個 Process 的 Initiator Role 裡' })
  start(
    @Body() body: StartRequestDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<RequestDetail> {
    return this.requests.start(body, me);
  }

  /**
   * 看得到的所有 Request：自己發起的、經手過的、所屬 Role 是 Observer Role 的 Process 的；
   * 持有 request.view_all 時是全部。
   */
  @Get()
  @RequireParticipant()
  @ApiOkResponse({ type: RequestSummaryListDto })
  visible(@CurrentParticipant() me: ActiveParticipant): Promise<RequestSummary[]> {
    return this.requests.visible(me);
  }

  @Get('mine')
  @RequireParticipant()
  @ApiOkResponse({ type: RequestSummaryListDto })
  mine(@CurrentParticipant() me: ActiveParticipant): Promise<RequestSummary[]> {
    return this.requests.mine(me);
  }

  /** 尚未結束（running 或 returned）的所有 Request，給 Administrator 處理例外狀況（Cancel、Reassign）。 */
  @Get('active')
  @RequirePermission('request.cancel', 'task.reassign')
  @ApiOkResponse({ type: RequestSummaryListDto })
  active(): Promise<RequestSummary[]> {
    return this.requests.active();
  }

  /** 看得到的人（同 GET /requests）才能查看；其他人回 404。 */
  @Get(':id')
  @RequireParticipant()
  @ApiOkResponse({ type: RequestDetailDto })
  detail(@Id() id: string, @CurrentParticipant() me: ActiveParticipant): Promise<RequestDetail> {
    return this.requests.detail(id, me);
  }

  /** 發起人修改被 Return 的 Request 後重新送出；從 Process 的開頭重新開始。 */
  @Post(':id/resubmit')
  @HttpCode(200)
  @RequireParticipant()
  @ApiOkResponse({ type: RequestDetailDto })
  @ApiNotFoundResponse({ description: 'Request 不存在或不是你發起的' })
  @ApiConflictResponse({ description: 'Request 不在 returned 狀態' })
  resubmit(
    @Id() id: string,
    @Body() body: ResubmitRequestDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<RequestDetail> {
    return this.requests.resubmit(id, body, me);
  }

  /** 發起人在 Request 完成之前撤回；open 的 Task 全部作廢。 */
  @Post(':id/withdraw')
  @HttpCode(200)
  @RequireParticipant()
  @ApiOkResponse({ type: RequestDetailDto })
  @ApiNotFoundResponse({ description: 'Request 不存在或不是你發起的' })
  @ApiConflictResponse({ description: 'Request 已經完成或已經撤回' })
  withdraw(
    @Id() id: string,
    @Body() body: WithdrawRequestDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<RequestDetail> {
    return this.requests.withdraw(id, body, me);
  }

  /** Administrator 強制終止尚未完成的 Request（原因必填）；open 的 Task 全部作廢。 */
  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('request.cancel')
  @ApiOkResponse({ type: RequestSummaryDto })
  @ApiNotFoundResponse({ description: 'Request 不存在' })
  @ApiConflictResponse({ description: 'Request 已經完成、撤回或 Cancel' })
  cancel(
    @Id() id: string,
    @Body() body: CancelRequestDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<RequestSummary> {
    return this.requests.cancel(id, body, me);
  }
}

/** 「我的待辦」與完成 Task；以及 Administrator 的「待 Reassign」清單與 Reassign。 */
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('mine')
  @RequireParticipant()
  @ApiOkResponse({ type: MyTaskListDto })
  mine(
    @Query() query: MyTasksQueryDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<MyTask[]> {
    return this.tasks.mine(me, query.status);
  }

  /** 「待 Reassign」清單：直接指派給已停用 Participant 的 open Task。 */
  @Get('pending-reassign')
  @RequirePermission('task.reassign')
  @ApiOkResponse({ type: PendingReassignListDto })
  pendingReassign(): Promise<MyTask[]> {
    return this.tasks.pendingReassign();
  }

  /** 把 open 的 Task 改派給另一位 Participant：原 Task 作廢，回傳為新的處理人建立的 Task。 */
  @Post(':id/reassign')
  @HttpCode(200)
  @RequirePermission('task.reassign')
  @ApiOkResponse({ type: MyTaskDto })
  @ApiNotFoundResponse({ description: 'Task 不存在' })
  @ApiConflictResponse({ description: 'Task 已經處理完、作廢，或 Request 已經結束' })
  reassign(
    @Id() id: string,
    @Body() body: ReassignTaskDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<MyTask> {
    return this.tasks.reassign(id, body, me);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequireParticipant()
  @ApiOkResponse({ type: RequestDetailDto })
  @ApiNotFoundResponse({ description: 'Task 不存在或不是指派給你' })
  @ApiConflictResponse({ description: '已由其他人處理，或 Task 版本已經變更' })
  complete(
    @Id() id: string,
    @Body() body: CompleteTaskDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<RequestDetail> {
    return this.tasks.complete(id, body, me);
  }
}
