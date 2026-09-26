import { connectDatabase } from '@river/db';
import { createEmailSender, emailEnvSchema } from '@river/email';
import { loggerEnvSchema } from '@river/logger';
import { Client, Connection } from '@temporalio/client';
import {
  S3AttachmentStorage,
  s3ConfigFromEnv,
  storageEnvSchema,
} from './attachment/attachment-storage.js';
import { createAuth } from './auth/create-auth.js';
import { apiEnvSchema, authOptionsFromEnv } from './config.js';
import { createApp } from './create-app.js';

const env = apiEnvSchema.parse(process.env);
const emailEnv = emailEnvSchema.parse(process.env);
const database = connectDatabase(env.DATABASE_URL);
const connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });

const app = await createApp({
  db: database.db,
  auth: createAuth(database.db, authOptionsFromEnv(env)),
  emailSender: createEmailSender(emailEnv),
  appUrl: env.BETTER_AUTH_URL,
  storage: new S3AttachmentStorage(s3ConfigFromEnv(storageEnvSchema.parse(process.env))),
  temporal: new Client({ connection, namespace: env.TEMPORAL_NAMESPACE }),
  taskQueue: env.TEMPORAL_TASK_QUEUE,
  log: loggerEnvSchema.parse(process.env),
});
app.enableShutdownHooks();
await app.listen(env.PORT);

process.once('beforeExit', async () => {
  await connection.close();
  await database.close();
});
