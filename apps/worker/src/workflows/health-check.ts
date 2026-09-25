import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities.js';

const { checkDatabase } = proxyActivities<Activities>({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 3 },
});

/** 確認 api → Temporal → worker → Postgres 整條路徑可以跑通。 */
export async function healthCheck(): Promise<'ok'> {
  await checkDatabase();
  return 'ok';
}
