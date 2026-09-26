import type { Permission } from '@river/auth';
import {
  type Database,
  processes,
  processInitiatorRoles,
  processObserverRoles,
  processVersions,
  requests,
  roleMembers,
  tasks,
} from '@river/db';
import { eq, inArray, notInArray, or, type SQL } from 'drizzle-orm';
import { assignedToOrHandledBy } from '../request/task-access.js';

/**
 * 資料層級的存取檢查：誰可以發起哪個 Process、誰看得到哪筆 Request。
 * 都寫成 SQL 條件放進查詢的 WHERE，列表與明細共用同一個條件，不會一邊漏檢查。
 * Role 成員在查詢當下決定，加入或移出 Role 立刻生效。
 */

type Db = Pick<Database, 'select'>;

/** 查看 Request 的人：ID 與 Permission（request.view_all 看得到全部）。 */
export interface Viewer {
  id: string;
  permissions: readonly Permission[];
}

/** 這位 Participant 所屬的 Role（子查詢）。 */
function rolesOf(db: Db, participantId: string) {
  return db
    .select({ roleId: roleMembers.roleId })
    .from(roleMembers)
    .where(eq(roleMembers.participantId, participantId));
}

/**
 * 可以發起的 Process（條件套在 processes.id 上）：沒有設定 Initiator Role，
 * 或這位 Participant 是其中任一個 Initiator Role 的成員。
 */
export function startableBy(db: Db, participantId: string): SQL {
  const restricted = db
    .select({ processId: processInitiatorRoles.processId })
    .from(processInitiatorRoles);
  const allowed = db
    .select({ processId: processInitiatorRoles.processId })
    .from(processInitiatorRoles)
    .where(inArray(processInitiatorRoles.roleId, rolesOf(db, participantId)));
  return or(notInArray(processes.id, restricted), inArray(processes.id, allowed)) as SQL;
}

/**
 * 看得到的 Request（條件套在 requests 上）；持有 request.view_all 時沒有限制（undefined）。其他人只看得到：
 * - 自己發起的；
 * - 有 Task 指派給自己或自己所屬的 Role，或自己處理過 Task 的（關係人）；
 * - 自己所屬的 Role 是該 Process 的 Observer Role 的。
 */
export function visibleTo(db: Db, viewer: Viewer): SQL | undefined {
  if (viewer.permissions.includes('request.view_all')) return undefined;
  const involved = db
    .select({ requestId: tasks.requestId })
    .from(tasks)
    .where(assignedToOrHandledBy(db, viewer.id));
  const observed = db
    .select({ id: processVersions.id })
    .from(processVersions)
    .innerJoin(processObserverRoles, eq(processObserverRoles.processId, processVersions.processId))
    .where(inArray(processObserverRoles.roleId, rolesOf(db, viewer.id)));
  return or(
    eq(requests.initiatorId, viewer.id),
    inArray(requests.id, involved),
    inArray(requests.processVersionId, observed),
  ) as SQL;
}
