import { PERMISSION_PRESETS, PERMISSIONS, type Permission } from '@river/auth';

export type PermissionGroup = 'designer' | 'administrator' | 'separate';

/** 畫面上顯示的 Permission 名稱與說明。 */
export const PERMISSION_LABELS: Record<Permission, { label: string; description: string }> = {
  'process.edit': { label: '編輯 Process', description: '建立與修改 Process 和 Form 的草稿。' },
  'process.publish': {
    label: '發佈 Process',
    description: '把草稿發佈成新的 Process Version，讓 Participant 可以發起。',
  },
  'user.manage': {
    label: '管理人員',
    description: '建立 Participant、寄出邀請信，設定 Manager 與 Permission。',
  },
  'role.manage': { label: '管理 Role', description: '建立、改名 Role，新增或移除成員。' },
  'request.cancel': {
    label: 'Cancel Request',
    description: '強制終止任何一筆尚未完成的 Request。',
  },
  'task.reassign': {
    label: 'Reassign Task',
    description: '把未完成的 Task 改派給另一位 Participant。',
  },
  'request.view_all': {
    label: '查看全部 Request',
    description: '查看平台上每一筆 Request 的內容與歷程。',
  },
  'service_account.manage': {
    label: '管理 Service Account',
    description: '建立 Service Account、設定它可以發起的 Process，發放與輪替 API key。',
  },
  'credential.manage': {
    label: '管理 Credential',
    description: '建立與輪替外部系統的憑證。不在任何預設組合中，必須單獨授予。',
  },
};

function groupOf(permission: Permission): PermissionGroup {
  const designer: readonly Permission[] = PERMISSION_PRESETS.designer;
  const administrator: readonly Permission[] = PERMISSION_PRESETS.administrator;
  if (designer.includes(permission)) return 'designer';
  if (administrator.includes(permission)) return 'administrator';
  return 'separate';
}

/** 依預設組合分組；不屬於任何組合的（credential.manage）放在「單獨授予」。 */
export const PERMISSION_GROUPS: {
  key: PermissionGroup;
  label: string;
  permissions: Permission[];
}[] = (
  [
    { key: 'designer', label: 'Designer' },
    { key: 'administrator', label: 'Administrator' },
    { key: 'separate', label: '單獨授予' },
  ] as const
).map((g) => ({ ...g, permissions: PERMISSIONS.filter((p) => groupOf(p) === g.key) }));

export type Preset = keyof typeof PERMISSION_PRESETS;

/** 加上預設組合的 Permission；原本持有的保留。 */
export function withPreset(current: readonly Permission[], preset: Preset): Permission[] {
  const added: readonly Permission[] = PERMISSION_PRESETS[preset];
  return PERMISSIONS.filter((p) => current.includes(p) || added.includes(p));
}

/** 完整持有哪些預設組合，例如 "Designer" 或 "Designer + Administrator"。 */
export function presetLabel(permissions: readonly Permission[]): string | null {
  const names = (Object.keys(PERMISSION_PRESETS) as Preset[])
    .filter((preset) =>
      PERMISSION_PRESETS[preset].every((p: Permission) => permissions.includes(p)),
    )
    .map((preset) => (preset === 'designer' ? 'Designer' : 'Administrator'));
  return names.length ? names.join(' + ') : null;
}
