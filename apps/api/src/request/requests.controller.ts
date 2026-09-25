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
  startRequestSchema,
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

const Id = () => Param('id', new ParseUUIDPipe());

/** 入口網站的 Request：發起、「我的申請」、明細與時間軸。 */
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
