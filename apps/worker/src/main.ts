import { connectDatabase } from '@river/db';
import { createEmailSender, emailEnvSchema } from '@river/email';
import { createLogger, loggerEnvSchema } from '@river/logger';
import { makeTelemetryFilterString, NativeConnection, Runtime } from '@temporalio/worker';
import { z } from 'zod';
import { temporalLogger } from './temporal-logger.js';
import { createWorker } from './worker.js';

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
    TEMPORAL_NAMESPACE: z.string().default('default'),
    TEMPORAL_TASK_QUEUE: z.string().default('river'),
    /** 瀏覽器看到的網址（和 api 共用同一個設定），信件裡的連結以它為準。 */
    BETTER_AUTH_URL: z.url(),
  })
  .parse(process.env);
const emailEnv = emailEnvSchema.parse(process.env);

const logger = createLogger(loggerEnvSchema.parse(process.env), 'worker');
// 必須在建立任何 connection 之前安裝；core 的 log 也轉送過來，不再直接印到 console。
Runtime.install({
  logger: temporalLogger(logger),
  telemetryOptions: {
    logging: { filter: makeTelemetryFilterString({ core: 'WARN' }), forward: {} },
  },
});
const database = connectDatabase(env.DATABASE_URL);
const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });
const worker = await createWorker({
  connection,
  namespace: env.TEMPORAL_NAMESPACE,
  taskQueue: env.TEMPORAL_TASK_QUEUE,
  db: database.db,
  emailSender: createEmailSender(emailEnv),
  appUrl: env.BETTER_AUTH_URL,
});

logger.info({ taskQueue: env.TEMPORAL_TASK_QUEUE }, 'worker started');
try {
  await worker.run();
} finally {
  await connection.close();
  await database.close();
}
