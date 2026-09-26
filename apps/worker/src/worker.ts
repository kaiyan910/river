import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from '@river/db';
import type { EmailSender } from '@river/email';
import { type NativeConnection, Worker } from '@temporalio/worker';
import { createActivities } from './activities.js';

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
}

export function createWorker({
  connection,
  namespace,
  taskQueue,
  db,
  emailSender,
  appUrl,
}: WorkerDeps) {
  return Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath,
    activities: createActivities(db, { emailSender, appUrl }),
  });
}
