import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import type { S3Config } from '../src/attachment/attachment-storage.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Testcontainers 啟動的 Postgres；每個測試檔在上面建立自己的 database。 */
    postgresUrl: string;
    /** Testcontainers 啟動的 Garage（和正式環境同一套 S3 相容 object storage）；所有測試檔共用一個 bucket。 */
    s3: S3Config;
  }
}

let postgres: StartedPostgreSqlContainer | undefined;
let garage: StartedTestContainer | undefined;

export async function setup(project: TestProject) {
  [postgres, garage] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    startGarage(),
  ]);
  project.provide('postgresUrl', postgres.getConnectionUri());
  project.provide('s3', await setUpGarage(garage));
}

export async function teardown() {
  await Promise.all([postgres?.stop(), garage?.stop()]);
}

const GARAGE_CONFIG = `
metadata_dir = "/tmp/meta"
data_dir = "/tmp/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "${'0'.repeat(64)}"

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"
`;

function startGarage(): Promise<StartedTestContainer> {
  return new GenericContainer('dxflrs/garage:v2.4.1')
    .withCopyContentToContainer([{ content: GARAGE_CONFIG, target: '/etc/garage.toml' }])
    .withExposedPorts(3900)
    .withWaitStrategy(Wait.forLogMessage(/S3 API server listening/))
    .start();
}

/** 單節點 layout、測試用的 access key 與 bucket（同 deploy/README.md 的步驟）。 */
async function setUpGarage(container: StartedTestContainer): Promise<S3Config> {
  const garage = async (...args: string[]) => {
    const result = await container.exec(['/garage', ...args]);
    if (result.exitCode !== 0) throw new Error(`garage ${args.join(' ')} 失敗：${result.output}`);
    return result.stdout;
  };
  const nodeId = (await garage('node', 'id', '-q')).trim().split('@')[0] ?? '';
  await garage('layout', 'assign', '-z', 'test', '-c', '1G', nodeId);
  await garage('layout', 'apply', '--version', '1');

  const config: S3Config = {
    endpoint: `http://${container.getHost()}:${container.getMappedPort(3900)}`,
    region: 'garage',
    bucket: 'river-attachments',
    accessKeyId: 'GK0123456789abcdef01234567',
    secretAccessKey: 'f'.repeat(64),
  };
  await garage('key', 'import', '--yes', '-n', 'river', config.accessKeyId, config.secretAccessKey);
  await garage('bucket', 'create', config.bucket);
  await garage('bucket', 'allow', '--read', '--write', '--owner', config.bucket, '--key', 'river');
  return config;
}
