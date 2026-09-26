import type { InterpretProcessInput, ScheduledStartInput } from '@river/contracts/workflow';
import { log, ParentClosePolicy, proxyActivities, startChild, uuid4 } from '@temporalio/workflow';
import type { ScheduledStartActivities } from '../scheduled-start.js';
import { interpretProcess } from './interpret-process.js';

const { startScheduledRequest } = proxyActivities<ScheduledStartActivities>({
  startToCloseTimeout: '30 seconds',
});

/** 通知是盡力而為：寄信服務故障時重試幾次就放棄。 */
const bestEffortMail = proxyActivities<ScheduledStartActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 5 },
});

/**
 * Process 的 Temporal Schedule 每次時間到就啟動一次：建立 Request，再以 child workflow 啟動 interpreter
 * （workflow ID 等於 Request ID，和在平台上發起的一樣）。child 在這個 workflow 結束後繼續執行（ABANDON）。
 * 發起人已停用等原因而跳過時，通知 Administrator。
 */
export async function scheduledStart({ processId }: ScheduledStartInput): Promise<void> {
  // Request ID 由 workflow 產生，activity 重試時不會重複建立。
  const result = await startScheduledRequest({ processId, requestId: uuid4() });
  if (result.status === 'skipped') {
    if (!result.reason) return;
    try {
      await bestEffortMail.notifyScheduledStartSkipped({ processId, reason: result.reason });
    } catch (error) {
      log.warn('排程發起跳過的通知寄送失敗，略過', { processId, error });
    }
    return;
  }
  const input: InterpretProcessInput = {
    requestId: result.requestId,
    processVersionId: result.processVersionId,
  };
  await startChild(interpretProcess, {
    workflowId: result.requestId,
    args: [input],
    parentClosePolicy: ParentClosePolicy.ABANDON,
  });
}
