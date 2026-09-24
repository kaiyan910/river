import type { Database } from '@river/db';
import { sql } from 'drizzle-orm';

export function createActivities(db: Database) {
  return {
    async checkDatabase(): Promise<void> {
      await db.execute(sql`select 1`);
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
