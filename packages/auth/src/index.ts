/** 程式碼中固定的 Permission 清單（見 docs/TECH-STACK.md「認證與權限」）。 */
export const PERMISSIONS = [
  'process.edit',
  'process.publish',
  'credential.manage',
  'user.manage',
  'role.manage',
  'request.cancel',
  'task.reassign',
  'request.view_all',
  'service_account.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Permission 的預設組合。`credential.manage` 不在任何組合中，必須單獨授予。 */
export const PERMISSION_PRESETS = {
  designer: ['process.edit', 'process.publish'],
  administrator: [
    'user.manage',
    'role.manage',
    'request.cancel',
    'task.reassign',
    'request.view_all',
    'service_account.manage',
  ],
} as const satisfies Record<string, readonly Permission[]>;
