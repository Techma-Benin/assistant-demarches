import type { AdminProfile } from './console-types';

/** Operator permissions (models / MCP configuration) are separate from the business console. */
const OPERATOR_PERMISSIONS = new Set(['operator:read', 'operator:write']);

export const hasOperatorPermission = (profile: AdminProfile | null): boolean =>
  !!profile?.permissions.some((permission) => OPERATOR_PERMISSIONS.has(permission));

/** Super admin, or an active `admin` membership on the selected department. */
export function canManageUsers(profile: AdminProfile | null, departmentId: string | null): boolean {
  if (!profile) return false;
  if (profile.superAdmin) return true;
  return profile.memberships.some(
    (membership) => membership.active && membership.role === 'admin' && membership.departmentId === departmentId,
  );
}

export const roleLabel = (role: 'agent' | 'admin'): string => (role === 'admin' ? 'Admin' : 'Agent');
