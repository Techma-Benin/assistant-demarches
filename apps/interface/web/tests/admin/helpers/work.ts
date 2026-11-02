import { vi } from 'vitest';
import type { AdminWorkItem } from '@/lib/admin/department-api';

export const item = (overrides: Partial<AdminWorkItem> = {}): AdminWorkItem => ({
  id: 'req_00000000000000000000000001',
  procedureId: 'casier-simulation',
  status: 'submitted',
  fields: {},
  fileIds: [],
  officialLink: null,
  updatedAt: '2026-10-30T10:00:00Z',
  administrationId: 'justice',
  title: 'Casier judiciaire — simulation',
  revision: 3,
  createdAt: '2026-10-30T09:00:00Z',
  submittedAt: '2026-10-30T09:30:00Z',
  simulation: true,
  receiptRef: 'REC-0001',
  ...overrides,
});

export interface ConsoleStub {
  departmentId: string | null;
  isSuperAdmin: boolean;
  loading: boolean;
  error: unknown;
  departments: { id: string; name: string }[];
  reload: () => void;
}

export const consoleStub: ConsoleStub = {
  departmentId: 'justice',
  isSuperAdmin: false,
  loading: false,
  error: null,
  departments: [
    { id: 'justice', name: 'Justice' },
    { id: 'enseignement', name: 'Enseignement' },
  ],
  reload: vi.fn(),
};

export const resetConsole = (overrides: Partial<ConsoleStub> = {}) =>
  Object.assign(consoleStub, {
    departmentId: 'justice',
    isSuperAdmin: false,
    loading: false,
    error: null,
  }, overrides);

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
    const call: Call = {
      url: new URL(String(input), 'http://console.local'),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}
