/**
 * api 與 worker 之間的 Temporal 合約：workflow 與 Signal 的名稱和 payload。
 * 刻意不依賴任何套件，workflow sandbox 可以直接 import。
 * payload 只帶 ID 與決策結果，絕不帶 Form 資料。
 */

/** 通用的 interpreter workflow；workflow ID 等於 Request ID。 */
export const INTERPRET_PROCESS_WORKFLOW = 'interpretProcess';

export interface InterpretProcessInput {
  requestId: string;
  processVersionId: string;
  /**
   * 這一次執行對應 Request 的第幾輪；沒有時是 1。
   * 重新送出後 workflow 以 continueAsNew 帶著新的輪次從頭執行。
   */
  round?: number;
}

/** API 以樂觀鎖完成 Task 之後送出。workflow 忽略重複或不在等待中的 taskId。 */
export const TASK_COMPLETED_SIGNAL = 'taskCompleted';

export interface TaskCompletedSignal {
  taskId: string;
  /** 只有決策結果；填表 Task 的 Form 資料留在 Postgres，不會放進 Signal。 */
  outcome: 'approved' | 'returned' | 'submitted';
}

/**
 * 發起人重新送出被 Return 的 Request 後，API 提交 transaction 才送出。
 * round 是重新送出後的輪次；workflow 只在 round 比目前執行的輪次新時才從頭開始，所以可以安全重送。
 */
export const RESUBMITTED_SIGNAL = 'resubmitted';

export interface ResubmittedSignal {
  round: number;
}

/** 發起人 Withdraw 後，API 提交 transaction 才送出；workflow 收到後直接結束。重複送出沒有影響。 */
export const WITHDRAW_SIGNAL = 'withdraw';

/** Administrator Cancel 後，API 提交 transaction 才送出；和 withdraw 一樣，workflow 收到後直接結束。重複送出沒有影響。 */
export const CANCEL_SIGNAL = 'cancel';

/**
 * Administrator Reassign 後，API 提交 transaction 才送出：taskId 已經作廢，改由 newTaskId 接手。
 * workflow 改等 newTaskId 的 taskCompleted，並通知新的處理人。重複送出沒有影響。
 */
export const REASSIGN_SIGNAL = 'reassign';

export interface ReassignSignal {
  taskId: string;
  newTaskId: string;
}

/**
 * HTTP 節點重試全部失敗後 Request 暫停；Administrator 按下重試、API 提交 transaction 後送出。
 * sequence 是這筆 Request 第幾次重試（request.retried 事件的數量）：workflow 只在 sequence 比看過的新時才重試
 * 暫停中的 HTTP 節點，所以可以安全重送。
 */
export const RETRY_SIGNAL = 'retry';

export interface RetrySignal {
  sequence: number;
}

/**
 * 排程發起：Process 的 Temporal Schedule 每次時間到就啟動這個 workflow。
 * 它以排程上指定的 Participant 為發起人、Process 的目前版本建立 Request，再以 child workflow 啟動 interpreter。
 * 輸入只有 Process ID；發起人、cron 都在 Postgres，修改設定不需要改 Schedule 的輸入。
 */
export const SCHEDULED_START_WORKFLOW = 'scheduledStart';

export interface ScheduledStartInput {
  processId: string;
}

/** 每個 Process 最多一個排程；Temporal Schedule 的 ID 由 Process ID 決定。 */
export function scheduleIdOf(processId: string): string {
  return `process-schedule-${processId}`;
}

/** 排程的 cron 一律以這個時區解讀（和 Form 的日期同一個時區）。 */
export const SCHEDULE_TIME_ZONE = 'Asia/Taipei';
