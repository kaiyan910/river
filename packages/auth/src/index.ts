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

/**
 * 影響重大的 Permission：持有的人必須先啟用 TOTP 才能使用（見 docs/TECH-STACK.md「MFA」）。
 * 沒有啟用前，這些 Permission 仍然授予給他，只是 API 不接受。
 */
export const TOTP_REQUIRED_PERMISSIONS = [
  'credential.manage',
  'user.manage',
  'process.publish',
] as const satisfies readonly Permission[];

export function requiresTotp(permission: Permission): boolean {
  return (TOTP_REQUIRED_PERMISSIONS as readonly Permission[]).includes(permission);
}

/** 實際可以使用的 Permission：還沒啟用 TOTP 時，排除需要 TOTP 的 Permission。 */
export function usablePermissions(
  held: readonly Permission[],
  twoFactorEnabled: boolean,
): Permission[] {
  return twoFactorEnabled ? [...held] : held.filter((p) => !requiresTotp(p));
}
