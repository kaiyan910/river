import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import {
  completeTaskSchema,
  type MyTask,
  myTaskListSchema,
  myTasksQuerySchema,
  type RequestDetail,
  type RequestSummary,
  requestDetailSchema,
  requestSummaryListSchema,
  resubmitRequestSchema,
  startRequestSchema,
  withdrawRequestSchema,
} from '@river/contracts';
import { createZodDto } from 'nestjs-zod';
import type { ActiveParticipant } from '../auth/active-participant.js';
import { CurrentParticipant, RequireParticipant } from '../auth/require-permission.js';
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

const Id = () => Param('id', new ParseUUIDPipe());

/** 入口網站的 Request：發起、「我的申請」、明細與時間軸、重新送出與 Withdraw。 */
@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Post()
  @RequireParticipant()
  @ApiCreatedResponse({ type: RequestDetailDto })
  @ApiNotFoundResponse({ description: 'Process 不存在或還沒發佈' })
  start(
    @Body() body: StartRequestDto,
    @CurrentParticipant() me: ActiveParticipant,
  ): Promise<RequestDetail> {
    return this.requests.start(body, me);
  }

  @Get('mine')
  @RequireParticipant()
  @ApiOkResponse({ type: RequestSummaryListDto })
  mine(@CurrentParticipant() me: ActiveParticipant): Promise<RequestSummary[]> {
    return this.requests.mine(me);
  }

  /** 發起人與經手的審批人可以查看；其他人回 404。 */
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
}

/** 「我的待辦」與完成 Task。 */
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
