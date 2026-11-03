import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminClient } from '@/lib/admin/api';
import { AdminError, toFailure } from '@/lib/admin/errors';
import { CASE_ID, DOC_ID, OFFICIAL_ID, caseItem, json, problem } from './helpers/fixtures';

afterEach(() => vi.unstubAllGlobals());

function client(response: () => Response = () => json({ items: [], nextCursor: null })) {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response());
  return { api: new AdminClient(fetchMock as unknown as typeof fetch), fetchMock };
}
const lastCall = (fetchMock: ReturnType<typeof client>['fetchMock']) => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: new URL(String(url), 'http://x'), init: init as RequestInit, headers: (init as RequestInit).headers as Record<string, string> };
};

describe('AdminClient', () => {
  it('builds the case list query with view and the chosen administration, skipping empty parameters', async () => {
    const { api, fetchMock } = client();
    await api.listCases({ view: 'pending', administrationId: 'justice', cursor: null, limit: 20 });
    const { url, init } = lastCall(fetchMock);
    expect(url.pathname).toBe('/api/admin/v1/admin/cases');
    expect(Object.fromEntries(url.searchParams)).toEqual({ view: 'pending', administrationId: 'justice', limit: '20' });
    expect(init.method).toBe('GET');
    await api.listCases({ view: 'rejected' });
    expect(Object.fromEntries(lastCall(fetchMock).url.searchParams)).toEqual({ view: 'rejected' });
  });

  it('sends administrationId on officials, dashboard, activity and unanswered, never departmentId', async () => {
    const { api, fetchMock } = client(() => json({}));
    await api.listOfficials({ administrationId: 'anip' });
    await api.getDashboard({ administrationId: 'anip' });
    await api.listActivity({ administrationId: 'anip', caseId: CASE_ID });
    await api.listUnanswered({ administrationId: 'anip', status: 'open' });
    const params = fetchMock.mock.calls.map(([url]) => Object.fromEntries(new URL(String(url), 'http://x').searchParams));
    expect(params).toEqual([
      { administrationId: 'anip' },
      { administrationId: 'anip' },
      { administrationId: 'anip', caseId: CASE_ID },
      { administrationId: 'anip', status: 'open' },
    ]);
  });

  it('sends a traceparent on every call', async () => {
    const { api, fetchMock } = client(() => json({}));
    await api.me();
    expect(lastCall(fetchMock).headers.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  });

  it('POSTs an action with exactly { action, note }, the Idempotency-Key and no revision', async () => {
    const { api, fetchMock } = client(() => json(caseItem()));
    await api.act(CASE_ID, { action: 'reject', note: 'Pièce illisible' }, 'act-key-12345');
    const { url, init, headers } = lastCall(fetchMock);
    expect(url.pathname).toBe(`/api/admin/v1/admin/cases/${CASE_ID}/actions`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'reject', note: 'Pièce illisible' });
    expect(headers['idempotency-key']).toBe('act-key-12345');
    expect(headers['content-type']).toBe('application/json');
    await api.act(CASE_ID, { action: 'claim', note: null }, 'act-key-67890');
    expect(JSON.parse(String(lastCall(fetchMock).init.body))).toEqual({ action: 'claim', note: null });
  });

  it('POSTs the resolution of an unanswered question without body', async () => {
    const { api, fetchMock } = client(() => json({ id: 'unq_x', status: 'resolved' }));
    await api.resolveUnanswered('unq_01JD0000000000000000000001');
    const { url, init } = lastCall(fetchMock);
    expect(url.pathname).toBe('/api/admin/v1/admin/unanswered/unq_01JD0000000000000000000001/resolve');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('PUTs the profile and the official update', async () => {
    const { api, fetchMock } = client(() => json({}));
    await api.updateMe({ displayName: 'A', jobTitle: 'B' });
    expect(lastCall(fetchMock).init.method).toBe('PUT');
    expect(lastCall(fetchMock).url.pathname).toBe('/api/admin/v1/admin/me');
    await api.updateOfficial(OFFICIAL_ID, { administrationId: 'anip', role: 'admin', active: false });
    expect(lastCall(fetchMock).url.pathname).toBe(`/api/admin/v1/admin/officials/${OFFICIAL_ID}`);
    expect(JSON.parse(String(lastCall(fetchMock).init.body))).toEqual({ administrationId: 'anip', role: 'admin', active: false });
  });

  it('uploads the avatar as a raw body with X-File-Mime-Type', async () => {
    const { api, fetchMock } = client(() => json({}));
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await api.uploadAvatar(file, 'image/png');
    const { url, init, headers } = lastCall(fetchMock);
    expect(url.pathname).toBe('/api/admin/v1/admin/me/avatar');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(file);
    expect(headers['x-file-mime-type']).toBe('image/png');
    expect(headers['content-type']).toBe('application/octet-stream');
  });

  it('parses a problem+json error and keeps the status when the body is not JSON', async () => {
    const withProblem = client(() => problem(409, 'INVALID_TRANSITION', 'Le dossier est déjà complété'));
    const error = await withProblem.api.getCase(CASE_ID).catch((e) => e);
    expect(error).toBeInstanceOf(AdminError);
    expect(error).toMatchObject({ status: 409, problem: { code: 'INVALID_TRANSITION' }, message: 'Le dossier est déjà complété' });
    const plain = client(() => new Response('<html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    expect(await plain.api.me().catch((e) => e)).toMatchObject({ status: 502, problem: undefined });
  });

  it('builds the private download and avatar URLs', () => {
    const { api } = client();
    expect(api.documentUrl(CASE_ID, DOC_ID)).toBe(`/api/admin/v1/admin/cases/${CASE_ID}/documents/${DOC_ID}`);
    expect(api.avatarUrl(OFFICIAL_ID)).toBe(`/api/admin/v1/admin/avatars/${OFFICIAL_ID}`);
  });
});

describe('toFailure', () => {
  it('shows the server detail for 409 INVALID_TRANSITION and flags a conflict', () => {
    const failure = toFailure(new AdminError(409, { code: 'INVALID_TRANSITION', detail: 'Le dossier est déjà complété' }));
    expect(failure).toEqual({ message: 'Le dossier est déjà complété', conflict: true, retryable: false });
  });
  it('maps the other statuses', () => {
    expect(toFailure(new AdminError(403)).message).toMatch(/pas le droit/);
    expect(toFailure(new AdminError(404)).message).toMatch(/n’existe plus/);
    expect(toFailure(new AdminError(400, { detail: 'note requise' })).message).toBe('Données refusées : note requise');
    expect(toFailure(new AdminError(413)).message).toMatch(/2 Mio/);
    expect(toFailure(new AdminError(415)).message).toMatch(/JPEG ou PNG/);
    expect(toFailure(new AdminError(503))).toMatchObject({ retryable: true });
    expect(toFailure(new TypeError('offline'))).toMatchObject({ retryable: true, conflict: false });
  });
});
