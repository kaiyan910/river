import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

export * from './credential-cipher.js';
export * from './schema.js';
export { schema };

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  close(): Promise<void>;
}

export function connectDatabase(url: string): DatabaseConnection {
  const pool = new pg.Pool({ connectionString: url });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function migrateDatabase(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}
