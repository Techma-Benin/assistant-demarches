import type { AdminProfile, OfficialRole, Permission } from './console-types';

/** True when `GET /v1/admin/me` granted `permission`. The server refuses anyway: this only hides. */
export const can = (profile: AdminProfile | null, permission: Permission): boolean =>
  !!profile?.permissions.includes(permission);

const ROLE_LABELS: Record<OfficialRole, string> = {
  agent: 'Agent',
  admin: 'Administrateur',
  super_admin: 'Super administrateur',
};

export const roleLabel = (role: OfficialRole): string => ROLE_LABELS[role];
