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
}

/** API 以樂觀鎖完成 Task 之後送出。workflow 忽略重複或不在等待中的 taskId。 */
export const TASK_COMPLETED_SIGNAL = 'taskCompleted';

export interface TaskCompletedSignal {
  taskId: string;
  outcome: 'approved';
}
