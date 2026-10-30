import { describe, expect, it } from 'vitest';
import { accessLabel, activeIdentity, can, routeCapability, type Capability } from '@/lib/permissions';
import { DEMO_SESSION_IDENTITIES } from '@/server/session';

const [PLATFORM, ADMIN_WRITE, ADMIN_READ] = DEMO_SESSION_IDENTITIES;

const VIEWS: Capability[] = ['overview.view', 'procedures.view', 'conversations.view', 'tools.view', 'models.view', 'audit.view'];
const EDITS: Capability[] = ['procedures.edit', 'tools.edit', 'models.edit'];

describe('can', () => {
  it('platform write may do everything', () => {
    for (const capability of [...VIEWS, ...EDITS]) expect(can(PLATFORM, capability), capability).toBe(true);
  });

  it('administration write: overview, procedures (view+edit), conversations only', () => {
    const allowed: Capability[] = ['overview.view', 'procedures.view', 'procedures.edit', 'conversations.view'];
    for (const capability of [...VIEWS, ...EDITS]) {
      expect(can(ADMIN_WRITE, capability), capability).toBe(allowed.includes(capability));
    }
  });

  it('administration read: same views, no edit', () => {
    for (const capability of EDITS) expect(can(ADMIN_READ, capability), capability).toBe(false);
    for (const capability of ['overview.view', 'procedures.view', 'conversations.view'] as Capability[]) {
      expect(can(ADMIN_READ, capability), capability).toBe(true);
    }
    for (const capability of ['tools.view', 'models.view', 'audit.view'] as Capability[]) {
      expect(can(ADMIN_READ, capability), capability).toBe(false);
    }
  });

  it('refuses without identity', () => {
    expect(can(null, 'overview.view')).toBe(false);
    expect(can(undefined, 'overview.view')).toBe(false);
  });
});

describe('routeCapability', () => {
  it('maps routes to capabilities', () => {
    expect(routeCapability('/')).toBe('overview.view');
    expect(routeCapability('/procedures/demo-procedure')).toBe('procedures.view');
    expect(routeCapability('/tools')).toBe('tools.view');
    expect(routeCapability('/unknown/path')).toBe('overview.view');
  });
});

describe('accessLabel and activeIdentity', () => {
  it('labels access levels', () => {
    expect(accessLabel(PLATFORM)).toBe('Plateforme');
    expect(accessLabel(ADMIN_WRITE)).toBe('Écriture');
    expect(accessLabel(ADMIN_READ)).toBe('Lecture seule');
  });

  it('finds the active identity', () => {
    const session = { displayName: 'x', identities: DEMO_SESSION_IDENTITIES, activeIdentityId: ADMIN_READ.id };
    expect(activeIdentity(session)).toBe(ADMIN_READ);
    expect(activeIdentity({ ...session, activeIdentityId: 'nope' })).toBeNull();
    expect(activeIdentity(null)).toBeNull();
  });
});
