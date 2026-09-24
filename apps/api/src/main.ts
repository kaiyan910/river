import { connectDatabase } from '@river/db';
import { Client, Connection } from '@temporalio/client';
import { createAuth } from './auth/create-auth.js';
import { apiEnvSchema, authOptionsFromEnv } from './config.js';
import { createApp } from './create-app.js';

const env = apiEnvSchema.parse(process.env);
const database = connectDatabase(env.DATABASE_URL);
const connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });

const app = await createApp({
  db: database.db,
  auth: createAuth(database.db, authOptionsFromEnv(env)),
  temporal: new Client({ connection, namespace: env.TEMPORAL_NAMESPACE }),
  taskQueue: env.TEMPORAL_TASK_QUEUE,
  logLevel: env.LOG_LEVEL,
});
app.enableShutdownHooks();
await app.listen(env.PORT);

process.once('beforeExit', async () => {
  await connection.close();
  await database.close();
});
