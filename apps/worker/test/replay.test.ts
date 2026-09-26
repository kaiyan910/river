/**
 * Seam ③：Replay。用目前的 interpreter 重跑 test/histories/ 裡保存的 workflow history，
 * 確認修改 workflow 程式碼不會讓執行中的 Request 在重播時發生 nondeterminism。
 * 樣本由 apps/api 的 record-replay-histories 產生；新增、更新樣本與修改 interpreter 的規則見 docs/testing.md。
 */
import { readdir, readFile } from 'node:fs/promises';
import {
  DefaultLogger,
  makeTelemetryFilterString,
  type ReplayResult,
  Runtime,
  Worker,
} from '@temporalio/worker';
import { beforeAll, describe, expect, it } from 'vitest';
import { workflowOptions } from '../src/worker.js';

const HISTORIES = new URL('./histories/', import.meta.url);

/** 規格要求至少涵蓋的情境（Seam ③）；每一個都必須有樣本，刪掉樣本時測試會失敗。 */
const REQUIRED = ['approval', 'return-resubmit', 'parallel', 'escalation'];

Runtime.install({
  logger: new DefaultLogger('ERROR'),
  telemetryOptions: { logging: { filter: makeTelemetryFilterString({ core: 'ERROR' }) } },
});

async function loadHistories() {
  const files = (await readdir(HISTORIES)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(
    files.map(async (file) => ({
      // history 不含 workflow ID；interpreter 不依賴它，用檔名方便在失敗時看出是哪一個樣本。
      workflowId: file.replace(/\.json$/, ''),
      history: JSON.parse(await readFile(new URL(file, HISTORIES), 'utf8')) as unknown,
    })),
  );
}

describe('Replay：保存的 workflow history', () => {
  let histories: Awaited<ReturnType<typeof loadHistories>>;
  const results = new Map<string, ReplayResult>();

  beforeAll(async () => {
    histories = await loadHistories();
    for await (const result of Worker.runReplayHistories(workflowOptions, histories))
      results.set(result.workflowId, result);
  });

  it('涵蓋一般核准、Return 後重新送出、並行分支與 Escalation', () => {
    const names = histories.map((h) => h.workflowId);
    for (const name of REQUIRED) expect(names).toContain(name);
    // Return 後重新送出會 continueAsNew，第二個 run 也要重播。
    expect(names).toContain('return-resubmit.run2');
  });

  it('目前的 interpreter 重播每一個樣本都沒有 nondeterminism', () => {
    const failures = [...results.values()]
      .filter((r) => r.error)
      .map((r) => `${r.workflowId}: ${r.error?.name}: ${r.error?.message}`);
    expect(failures).toEqual([]);
    expect(results.size).toBe(histories.length);
  });
});
