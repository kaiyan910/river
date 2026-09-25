import type { Permission } from '@river/auth';
import {
  FileText,
  House,
  Inbox,
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
  /** 持有這個 Permission 才顯示；API 端仍會各自檢查。 */
  requires?: Permission;
}

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
export const MY_TASKS: NavItem = { to: '/tasks', label: '我的待辦', icon: Inbox };
export const MY_REQUESTS: NavItem = { to: '/requests', label: '我的申請', icon: FileText };
export const ROLES: NavItem = {
  to: '/admin/roles',
  label: 'Role',
  icon: Shield,
  requires: 'role.manage',
};

/** icon rail 的分組；組與組之間以分隔線隔開。 */
export const NAV_GROUPS: NavItem[][] = [
  [HOME, START_REQUEST, MY_TASKS, MY_REQUESTS],
  [PROCESSES],
  [
    PARTICIPANTS,
    ROLES,
    { to: '/admin/reassign', label: '待 Reassign', icon: Repeat, requires: 'task.reassign' },
    { to: '/admin/requests', label: '全部 Request', icon: List, requires: 'request.view_all' },
  ],
];

export function visibleNavGroups(permissions: readonly Permission[]): NavItem[][] {
  return NAV_GROUPS.map((group) => group.filter((item) => canAccess(item, permissions))).filter(
    (group) => group.length > 0,
  );
}

export function canAccess(item: NavItem, permissions: readonly Permission[]): boolean {
  return !item.requires || permissions.includes(item.requires);
}

const IMPLEMENTED: NavItem[] = [
  HOME,
  START_REQUEST,
  MY_TASKS,
  MY_REQUESTS,
  PARTICIPANTS,
  ROLES,
  PROCESSES,
];

/** 還沒有實作內容、先以佔位頁接好路由的導覽項目。 */
export const PLACEHOLDER_ITEMS: NavItem[] = NAV_GROUPS.flat().filter(
  (i) => !IMPLEMENTED.includes(i),
);
