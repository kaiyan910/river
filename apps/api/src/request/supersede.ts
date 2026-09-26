import { type Database, requestEvents, tasks } from '@river/db';
import { and, eq, sql } from 'drizzle-orm';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Return、Withdraw 或 Cancel 時，把 Request 所有 open 的 Task 改成 superseded，每一個都記一筆事件。
 * 呼叫前要先鎖住 Request（和 createTask activity 同樣的順序），workflow 才不會在這之後又建立新的 Task。
 */
export async function supersedeOpenTasks(tx: Tx, requestId: string): Promise<void> {
  const superseded = await tx
    .update(tasks)
    .set({ status: 'superseded', version: sql`${tasks.version} + 1` })
    .where(and(eq(tasks.requestId, requestId), eq(tasks.status, 'open')))
    .returning({ id: tasks.id });
  if (superseded.length === 0) return;
  await tx
    .insert(requestEvents)
    .values(superseded.map((t) => ({ requestId, type: 'task.superseded' as const, taskId: t.id })));
}
