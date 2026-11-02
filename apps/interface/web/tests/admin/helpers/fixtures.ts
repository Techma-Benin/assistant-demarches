import { vi } from 'vitest';
import type { Case, Dashboard } from '@/lib/admin/api';
import type { AdminProfile, Administration, Official, Permission } from '@/lib/admin/console-types';
import { anonymousOfficial } from '@/lib/admin/work-format';

// Shapes of contracts/v2/examples.json.
export const CASE_ID = 'cas_01JD0000000000000000000001';
export const DOC_ID = 'doc_01JD0000000000000000000001';
export const OFFICIAL_ID = 'off_01JD0000000000000000000001';
export const OTHER_OFFICIAL_ID = 'off_01JD0000000000000000000002';

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, detail, code, traceId: 'a'.repeat(32) }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

export const AGENT: Permission[] = ['cases:read', 'cases:act'];
export const ADMIN: Permission[] = [...AGENT, 'officials:read', 'officials:manage'];
export const SUPER: Permission[] = [...ADMIN, 'administrations:all'];

export const caseItem = (overrides: Partial<Case> = {}): Case => ({
  id: CASE_ID,
  reference: 'SIM-JUS-2026-000001',
  simulated: true,
  procedureId: 'PS00373',
  title: 'Délivrance du Casier judiciaire (Extrait B3 du casier judiciaire)',
  administrationId: 'justice',
  applicantRef: 'usr_01JD0000000000000000000001',
  requestId: 'req_01JD0000000000000000000001',
  channel: 'web',
  status: 'in_review',
  fields: { adresseDomicile: 'Cotonou, Akpakpa', profession: 'Comptable', nombreEnfantsACharge: 2, situationMatrimoniale: 'Marié' },
  documents: [
    {
      id: DOC_ID,
      kind: 'submitted',
      documentType: 'extrait-acte-naissance',
      name: 'Extrait d’acte de naissance',
      mimeType: 'application/pdf',
      sizeBytes: 182044,
      createdAt: '2026-11-02T09:05:00Z',
    },
  ],
  payment: { amountFcfa: 1900, status: 'paid', reference: 'SIM-PAY-000001', paidAt: '2026-11-02T09:06:00Z', simulated: true },
  steps: [
    { id: 'depot', label: 'Dossier déposé par l’assistant', state: 'done', actor: 'assistant', note: null, at: '2026-11-02T09:05:00Z' },
    { id: 'paiement', label: 'Frais payés', state: 'done', actor: 'applicant', note: null, at: '2026-11-02T09:06:00Z' },
    {
      id: 'verification',
      label: 'Vérification de l’identité par un agent',
      state: 'blocked',
      actor: 'administration',
      note: 'Nouvelle demande à vérifier',
      at: null,
    },
  ],
  informationRequest: null,
  claimedBy: null,
  completedBy: null,
  decisionNote: null,
  createdAt: '2026-11-02T09:05:00Z',
  updatedAt: '2026-11-02T09:06:00Z',
  ...overrides,
});

export const official = (overrides: Partial<Official> = {}): Official => ({
  id: OFFICIAL_ID,
  subject: '5b0c8a52-0d3e-4c1f-9d55-2b8f1c0e7a11',
  email: 'agent.justice@demo.techma.bj',
  displayName: 'Agent Justice',
  jobTitle: 'Agent instructeur',
  administrationId: 'justice',
  role: 'agent',
  avatarUrl: null,
  active: true,
  ...overrides,
});

export const administration = (id: string, name: string, connected = true): Administration => ({
  id,
  name,
  shortName: name,
  themes: [],
  connection: connected
    ? { status: 'connected', since: '2026-10-01T00:00:00Z' }
    : { status: 'not_connected', since: null },
});

export const JUSTICE = administration('justice', 'Ministère de la Justice');
export const ANIP = administration('anip', 'ANIP');
export const SANTE = administration('sante', 'Santé', false);

export const me = (permissions: Permission[] = AGENT, overrides: Partial<AdminProfile> = {}): AdminProfile => ({
  official: official(),
  administration: JUSTICE,
  permissions,
  ...overrides,
});

export const SUPER_ME = me(SUPER, {
  official: official({ id: OTHER_OFFICIAL_ID, displayName: 'Sam Super', role: 'super_admin', administrationId: null }),
  administration: null,
});

export const dashboard = (overrides: Partial<Dashboard['metrics']> = {}, unansweredOpen = 4): Dashboard => ({
  metrics: {
    administrationId: 'justice',
    period: { from: '2026-10-03T00:00:00Z', to: '2026-11-02T00:00:00Z' },
    received: 40,
    pending: 7,
    informationRequested: 2,
    completed: 25,
    completedByAssistant: 18,
    rejected: 3,
    medianProcessingHours: 30,
    byChannel: [
      { channel: 'web', count: 31 },
      { channel: 'whatsapp', count: 9 },
    ],
    topProcedures: [
      { procedureId: 'PS00373', title: 'Casier judiciaire', count: 22 },
      { procedureId: 'PS00393', title: 'Acte de naissance sécurisé', count: 11 },
    ],
    ...overrides,
  },
  unansweredOpen,
});

export interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/** Stubs fetch with a route handler; every call is recorded. */
export function stubFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.body;
    const call: Call = {
      url: new URL(String(input), 'http://console.local'),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof raw === 'string' ? JSON.parse(raw) : raw,
    };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

/** Mutable stand-in of `useConsole()` for the component tests that do not need the provider. */
export const consoleStub = {
  profile: me() as AdminProfile | null,
  official: official() as Official | null,
  administrations: [JUSTICE, ANIP],
  administrationId: 'justice' as string | null,
  administration: JUSTICE as Administration | null,
  isSuperAdmin: false,
  scopeId: undefined as string | undefined,
  loading: false,
  error: null as string | null,
  permissions: new Set<Permission>(AGENT),
  can: (permission: Permission) => consoleStub.permissions.has(permission),
  officialName: (id: string) => (id === OFFICIAL_ID ? 'Agent Justice' : anonymousOfficial(id)),
  selectAdministration: vi.fn(),
  setOfficial: vi.fn(),
  reload: vi.fn(),
};

export function resetConsole(permissions: Permission[] = AGENT, overrides: Partial<typeof consoleStub> = {}) {
  Object.assign(consoleStub, {
    profile: me(permissions),
    official: official(),
    administrations: [JUSTICE, ANIP],
    administrationId: 'justice',
    administration: JUSTICE,
    isSuperAdmin: permissions.includes('administrations:all'),
    scopeId: permissions.includes('administrations:all') ? 'justice' : undefined,
    loading: false,
    error: null,
    permissions: new Set(permissions),
  }, overrides);
  consoleStub.selectAdministration.mockReset();
  consoleStub.setOfficial.mockReset();
  consoleStub.reload.mockReset();
}

/** Factory for `vi.mock('@/components/admin/console/console-context', ...)`. */
export async function consoleModule() {
  const helpers = await import('./fixtures');
  return {
    useConsole: () => helpers.consoleStub,
    isConnected: (a: Administration) => a.connection.status === 'connected',
  };
}

/** Stubs fetch for the real ConsoleProvider: /me, /administrations, /officials, /dashboard and the cookie POST. */
export function stubConsole(options: {
  me: AdminProfile;
  administrations?: Administration[];
  officials?: Official[];
  pending?: number;
}) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const { calls: raw, fetchMock } = stubFetch((call) => {
    calls.push({ url: call.url.pathname + call.url.search, method: call.method, body: call.body });
    if (call.method === 'POST') return json({ ok: true });
    if (call.url.pathname.endsWith('/v1/admin/me')) return json(options.me);
    if (call.url.pathname.endsWith('/v1/admin/administrations')) {
      return json({ items: options.administrations ?? [JUSTICE] });
    }
    if (call.url.pathname.endsWith('/v1/admin/officials')) {
      return json({ items: options.officials ?? [], nextCursor: null });
    }
    if (call.url.pathname.endsWith('/v1/admin/dashboard')) return json(dashboard({ pending: options.pending ?? 0 }));
    return json({ items: [], nextCursor: null });
  });
  void raw;
  return { calls, fetchMock };
}
