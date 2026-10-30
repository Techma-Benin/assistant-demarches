import { vi } from 'vitest';
import type { AdminProfile, Department } from '@/lib/console-types';
import { json } from './c3-fetch';

export const SESSIONS = [
  { id: 'justice', label: 'Agent Justice' },
  { id: 'enseignement', label: 'Agent Enseignement' },
  { id: 'super', label: 'Super admin' },
];

export const dept = (id: string, name: string): Department => ({
  id,
  name,
  active: true,
  revision: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

export const JUSTICE = dept('justice', 'Justice');
export const ENSEIGNEMENT = dept('enseignement', 'Enseignement');

export const profile = (overrides: Partial<AdminProfile> = {}): AdminProfile => ({
  subject: 'agent-justice',
  displayName: 'Camille Agent',
  active: true,
  superAdmin: false,
  memberships: [{ departmentId: 'justice', role: 'agent', active: true }],
  revision: 1,
  departmentIds: ['justice'],
  permissions: ['department:read'],
  identityProvider: 'oidc',
  directorySource: 'backend-demo-adapter',
  ...overrides,
});

export const SUPER = profile({
  subject: 'super',
  displayName: 'Sam Super',
  superAdmin: true,
  memberships: [],
  departmentIds: [],
  permissions: ['department:read', 'admin:super'],
});

/** Stubs fetch for the console context: /me, /departments, pending work items, and the session POSTs. */
export function stubConsole(options: { profile: AdminProfile; departments?: Department[]; pending?: number }) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://console.local');
    const method = init?.method ?? 'GET';
    calls.push({ url: url.pathname + url.search, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'POST') return json({ ok: true });
    if (url.pathname.endsWith('/v1/admin/me')) return json(options.profile);
    if (url.pathname.endsWith('/v1/admin/departments')) {
      return json({ items: options.departments ?? [JUSTICE], nextCursor: null });
    }
    if (url.pathname.endsWith('/v1/admin/work-items')) {
      return json({ items: Array.from({ length: options.pending ?? 0 }, (_, i) => ({ id: `w${i}` })), nextCursor: null });
    }
    return json({ items: [], nextCursor: null });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}
