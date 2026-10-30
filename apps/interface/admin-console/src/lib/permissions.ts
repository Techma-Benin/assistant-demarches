// Who sees what in the console. The Backend stays the authority (filtering by administrationId, 403);
// this matrix drives the screens and the BFF's defence-in-depth checks. See docs/contract-question-admin-identities.md.

export type IdentityKind = 'platform' | 'administration';
export type Access = 'read' | 'write';

export interface Identity {
  id: string;
  kind: IdentityKind;
  /** Set for administration identities only. */
  administrationId?: string;
  label: string;
  access: Access;
}

export interface Session {
  displayName: string;
  identities: Identity[];
  activeIdentityId: string;
}

export type Capability =
  | 'overview.view'
  | 'procedures.view'
  | 'procedures.edit'
  | 'conversations.view'
  | 'tools.view'
  | 'tools.edit'
  | 'models.view'
  | 'models.edit'
  | 'audit.view';

const VIEW: Record<IdentityKind, Capability[]> = {
  platform: ['overview.view', 'procedures.view', 'conversations.view', 'tools.view', 'models.view', 'audit.view'],
  administration: ['overview.view', 'procedures.view', 'conversations.view'],
};

const EDIT: Record<IdentityKind, Capability[]> = {
  platform: ['procedures.edit', 'tools.edit', 'models.edit'],
  administration: ['procedures.edit'],
};

export function can(identity: Identity | null | undefined, capability: Capability): boolean {
  if (!identity) return false;
  if (VIEW[identity.kind].includes(capability)) return true;
  return identity.access === 'write' && EDIT[identity.kind].includes(capability);
}

export function activeIdentity(session: Session | null | undefined): Identity | null {
  return session?.identities.find((identity) => identity.id === session.activeIdentityId) ?? null;
}

/** Capability needed to open each console route (longest prefix wins via the route's first segment). */
export const ROUTE_CAPABILITY: Record<string, Capability> = {
  '/': 'overview.view',
  '/procedures': 'procedures.view',
  '/conversations': 'conversations.view',
  '/tools': 'tools.view',
  '/models': 'models.view',
  '/audit': 'audit.view',
};

export function routeCapability(pathname: string): Capability {
  const first = '/' + (pathname.split('/')[1] ?? '');
  return ROUTE_CAPABILITY[first] ?? 'overview.view';
}

/** Short French label for the access level, shown next to the identity. */
export function accessLabel(identity: Identity): string {
  if (identity.kind === 'platform') return 'Plateforme';
  return identity.access === 'write' ? 'Écriture' : 'Lecture seule';
}
