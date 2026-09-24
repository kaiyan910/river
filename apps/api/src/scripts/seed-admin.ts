/**
 * 建立第一位 Administrator。
 *
 *   SEED_ADMIN_EMAIL=... SEED_ADMIN_NAME=... SEED_ADMIN_PASSWORD=... bun run seed:admin
 */
import { PERMISSION_PRESETS } from '@river/auth';
import { authUsers, connectDatabase } from '@river/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createAuth } from '../auth/create-auth.js';
import { apiEnvSchema, authOptionsFromEnv } from '../config.js';
import { provisionParticipant } from '../participants/provision-participant.js';

const env = apiEnvSchema
  .extend({
    SEED_ADMIN_EMAIL: z.email(),
    SEED_ADMIN_NAME: z.string().min(1),
    SEED_ADMIN_PASSWORD: z.string().min(12),
  })
  .parse(process.env);

const database = connectDatabase(env.DATABASE_URL);
try {
  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  const [existing] = await database.db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.email, email));
  if (existing) {
    console.log(`${email} 已經存在，略過。`);
  } else {
    const auth = createAuth(database.db, authOptionsFromEnv(env));
    await provisionParticipant(auth, database.db, {
      email,
      name: env.SEED_ADMIN_NAME,
      password: env.SEED_ADMIN_PASSWORD,
      permissions: PERMISSION_PRESETS.administrator,
    });
    console.log(`已建立 Administrator：${email}`);
  }
} finally {
  await database.close();
}
