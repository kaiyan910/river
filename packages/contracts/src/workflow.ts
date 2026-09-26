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
