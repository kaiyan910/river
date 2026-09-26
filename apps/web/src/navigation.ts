import type { Permission } from '@river/auth';
import {
  Eye,
  FileText,
  House,
  Inbox,
  KeyRound,
  List,
  type LucideIcon,
  Plus,
  Repeat,
  Shield,
  Users,
  Workflow,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** 持有這個 Permission（陣列時持有其中任一個）才顯示；API 端仍會各自檢查。 */
  requires?: Permission | readonly Permission[];
}

/** 帳號安全（兩步驟驗證）；不在 icon rail 的分組裡，放在登出按鈕旁邊。 */
export const ACCOUNT_SECURITY_PATH = '/account/security';

export const HOME: NavItem = { to: '/', label: '首頁', icon: House };
export const START_REQUEST: NavItem = { to: '/start', label: '發起申請', icon: Plus };
export const PARTICIPANTS: NavItem = {
  to: '/admin/participants',
  label: '人員',
  icon: Users,
  requires: 'user.manage',
};
export const PROCESSES: NavItem = {
  to: '/designer/processes',
  label: '流程設計',
  icon: Workflow,
  requires: 'process.edit',
};
/** 外部系統的 Credential；credential.manage 不在任何預設組合中，必須單獨授予。 */
export const CREDENTIALS: NavItem = {
  to: '/designer/credentials',
  label: 'Credential',
  icon: KeyRound,
  requires: 'credential.manage',
};
export const MY_TASKS: NavItem = { to: '/tasks', label: '我的待辦', icon: Inbox };
export const MY_REQUESTS: NavItem = { to: '/requests', label: '我的申請', icon: FileText };
/** 看得到的所有 Request：經手過的、Observer Role 的 Process 的；持有 request.view_all 時是全部。 */
export const VISIBLE_REQUESTS: NavItem = {
  to: '/requests/visible',
  label: '可查看的 Request',
  icon: Eye,
};
export const ROLES: NavItem = {
  to: '/admin/roles',
  label: 'Role',
  icon: Shield,
  requires: 'role.manage',
};
/** 例外處理：「待 Reassign」清單、進行中的 Request 的 Reassign 與 Cancel。 */
export const REASSIGN: NavItem = {
  to: '/admin/reassign',
  label: '待 Reassign',
  icon: Repeat,
  requires: ['task.reassign', 'request.cancel'],
};

/** 外部系統透過外部 API 發起 Request 用的 Service Account 與 API key。 */
export const SERVICE_ACCOUNTS: NavItem = {
  to: '/admin/service-accounts',
  label: 'Service Account',
  icon: KeyRound,
  requires: 'service_account.manage',
};

/** icon rail 的分組；組與組之間以分隔線隔開。 */
export const NAV_GROUPS: NavItem[][] = [
  [HOME, START_REQUEST, MY_TASKS, MY_REQUESTS, VISIBLE_REQUESTS],
  [PROCESSES, CREDENTIALS],
  [
    PARTICIPANTS,
    ROLES,
    REASSIGN,
    SERVICE_ACCOUNTS,
    { to: '/admin/requests', label: '全部 Request', icon: List, requires: 'request.view_all' },
  ],
];

export function visibleNavGroups(permissions: readonly Permission[]): NavItem[][] {
  return NAV_GROUPS.map((group) => group.filter((item) => canAccess(item, permissions))).filter(
    (group) => group.length > 0,
  );
}

export function canAccess(item: NavItem, permissions: readonly Permission[]): boolean {
  if (!item.requires) return true;
  const required: readonly Permission[] =
    typeof item.requires === 'string' ? [item.requires] : item.requires;
  return required.some((p) => permissions.includes(p));
}

const IMPLEMENTED: NavItem[] = [
  HOME,
  START_REQUEST,
  MY_TASKS,
  MY_REQUESTS,
  VISIBLE_REQUESTS,
  PARTICIPANTS,
  ROLES,
  REASSIGN,
  SERVICE_ACCOUNTS,
  PROCESSES,
  CREDENTIALS,
];

/** 還沒有實作內容、先以佔位頁接好路由的導覽項目。 */
export const PLACEHOLDER_ITEMS: NavItem[] = NAV_GROUPS.flat().filter(
  (i) => !IMPLEMENTED.includes(i),
);

/** 手機版頂部列顯示的頁名：取 `to` 與目前路徑最長前綴相符的導覽項目。 */
export function currentPageLabel(pathname: string): string | undefined {
  const candidates = [...NAV_GROUPS.flat(), { to: ACCOUNT_SECURITY_PATH, label: '帳號安全' }];
  let best: { to: string; label: string } | undefined;
  for (const item of candidates) {
    const matches =
      item.to === '/'
        ? pathname === '/'
        : pathname === item.to || pathname.startsWith(`${item.to}/`);
    if (matches && (!best || item.to.length > best.to.length)) best = item;
  }
  return best?.label;
}
