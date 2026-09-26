import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CredentialCipher, Database } from '@river/db';
import type { EmailSender } from '@river/email';
import { type NativeConnection, Worker, type WorkerOptions } from '@temporalio/worker';
import { createActivities } from './activities.js';
import { createScheduledStartActivities } from './scheduled-start.js';

// 從原始碼執行（開發、測試）時載入 .ts，從建置結果執行時載入 .js。
const extension = extname(fileURLToPath(import.meta.url));
const fromSource = extension === '.ts';

type WebpackConfiguration = Parameters<
  NonNullable<NonNullable<WorkerOptions['bundlerOptions']>['webpackConfigHook']>
>[0];

/**
 * 打包 interpreter workflow 的設定；worker 與 replay 測試共用，確保重播的是同一份程式碼。
 * 從原始碼執行時，webpack 也要照 `source` 條件解析 workspace package（例如 @river/contracts/workflow），
 * 否則會去找還沒建置、或已經過時的 dist。
 */
export const workflowOptions = {
  workflowsPath: fileURLToPath(new URL(`./workflows/index${extension}`, import.meta.url)),
  bundlerOptions: fromSource
    ? {
        webpackConfigHook: (config: WebpackConfiguration): WebpackConfiguration => ({
          ...config,
          resolve: { ...config.resolve, conditionNames: ['source', '...'] },
        }),
      }
    : undefined,
} satisfies Pick<WorkerOptions, 'workflowsPath' | 'bundlerOptions'>;

export interface WorkerDeps {
  connection: NativeConnection;
  namespace: string;
  taskQueue: string;
  db: Database;
  emailSender: EmailSender;
  /** 瀏覽器看到的網址，信件裡的連結以它為準。 */
  appUrl: string;
  /** HTTP 節點在 activity 內解密 Credential 用；和 api 同一把金鑰。 */
  credentialCipher: CredentialCipher;
}

export function createWorker({
  connection,
  namespace,
  taskQueue,
  db,
  emailSender,
  appUrl,
  credentialCipher,
}: WorkerDeps) {
  return Worker.create({
    connection,
    namespace,
    taskQueue,
    ...workflowOptions,
    activities: {
      ...createActivities(db, { emailSender, appUrl }, credentialCipher),
      ...createScheduledStartActivities(db, { emailSender, appUrl }),
    },
  });
}
