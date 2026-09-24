import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Testcontainers 啟動的 Postgres；每個測試檔在上面建立自己的 database。 */
    postgresUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject) {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  project.provide('postgresUrl', container.getConnectionUri());
}

export async function teardown() {
  await container?.stop();
}
