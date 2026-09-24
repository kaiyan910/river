import { connectDatabase } from '@river/db';
import { NativeConnection } from '@temporalio/worker';
import { pino } from 'pino';
import { z } from 'zod';
import { createWorker } from './worker.js';

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
    TEMPORAL_NAMESPACE: z.string().default('default'),
    TEMPORAL_TASK_QUEUE: z.string().default('river'),
  })
  .parse(process.env);

const logger = pino({ name: 'worker' });
const database = connectDatabase(env.DATABASE_URL);
const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });
const worker = await createWorker({
  connection,
  namespace: env.TEMPORAL_NAMESPACE,
  taskQueue: env.TEMPORAL_TASK_QUEUE,
  db: database.db,
});

logger.info({ taskQueue: env.TEMPORAL_TASK_QUEUE }, 'worker started');
try {
  await worker.run();
} finally {
  await connection.close();
  await database.close();
}
