import { type Database, roleMembers, tasks } from '@river/db';
import type { Assignee } from '@river/dsl';
import { eq, inArray, or, type SQL } from 'drizzle-orm';

type TaskAssignment = Pick<typeof tasks.$inferSelect, 'assigneeId' | 'roleId'>;

/** Task 的指派對象；資料表以 check constraint 保證 assigneeId 與 roleId 剛好有一個。 */
export function taskAssignee(t: TaskAssignment): Assignee {
  if (t.roleId) return { type: 'role', roleId: t.roleId };
  if (t.assigneeId) return { type: 'participant', participantId: t.assigneeId };
  throw new Error('Task 沒有指派對象');
}

/**
 * 可以處理的 Task：直接指派給這位 Participant，或指派給他所屬的 Role。
 * Role 成員在查詢當下決定，所以加入或移出 Role 立刻反映在「我的待辦」。
 */
export function assignedTo(db: Pick<Database, 'select'>, participantId: string): SQL {
  const myRoles = db
    .select({ roleId: roleMembers.roleId })
    .from(roleMembers)
    .where(eq(roleMembers.participantId, participantId));
  return or(eq(tasks.assigneeId, participantId), inArray(tasks.roleId, myRoles)) as SQL;
}

/** 可以查看並得到處理結果的 Task：可以處理的，加上自己處理過的（即使之後被移出 Role）。 */
export function assignedToOrHandledBy(db: Pick<Database, 'select'>, participantId: string): SQL {
  return or(assignedTo(db, participantId), eq(tasks.completedBy, participantId)) as SQL;
}
