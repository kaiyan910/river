import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CredentialCipher, Database } from '@river/db';
import type { EmailSender } from '@river/email';
import { type NativeConnection, Worker } from '@temporalio/worker';
import { createActivities } from './activities.js';
import { createScheduledStartActivities } from './scheduled-start.js';

// 從原始碼執行（開發、測試）時載入 .ts，從建置結果執行時載入 .js。
const workflowsPath = fileURLToPath(
  new URL(`./workflows/index${extname(fileURLToPath(import.meta.url))}`, import.meta.url),
);

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
    workflowsPath,
    activities: {
      ...createActivities(db, { emailSender, appUrl }, credentialCipher),
      ...createScheduledStartActivities(db, { emailSender, appUrl }),
    },
  });
}
