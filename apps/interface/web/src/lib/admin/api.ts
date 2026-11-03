import type { Schemas } from '@techma/contracts-ts';
import { newTraceparent } from '@/lib/trace';
import { AdminError, type Problem } from './errors';

export type Case = Schemas['Case'];
export type CaseStatus = Schemas['CaseStatus'];
export type CaseView = Schemas['CaseView'];
export type CaseAction = Schemas['CaseActionInput']['action'];
export type CaseActionInput = Schemas['CaseActionInput'];
export type CaseDocument = Schemas['CaseDocument'];
export type CaseStep = Schemas['CaseStep'];
export type CasePage = Schemas['CasePage'];
export type Dashboard = Schemas['Dashboard'];
export type ActivityEntry = Schemas['ActivityEntry'];
export type ActivityPage = Schemas['ActivityPage'];
export type UnansweredEntry = Schemas['UnansweredEntry'];
export type UnansweredPage = Schemas['UnansweredPage'];
export type OfficialPage = Schemas['OfficialPage'];
export type OfficialInput = Schemas['OfficialInput'];
export type OfficialUpdate = Schemas['OfficialUpdate'];
export type OfficialCreated = Schemas['OfficialCreated'];
export type ProfileUpdate = Schemas['ProfileUpdate'];
type Official = Schemas['Official'];
type Me = Schemas['Me'];
type AdministrationList = Schemas['AdministrationList'];

export interface ListParams {
  /** Required for a super admin; the server forces it for everyone else. */
  administrationId?: string | null;
  cursor?: string | null;
  limit?: number;
}

type Query = Record<string, string | number | null | undefined>;

/** Client of the console routes (through the BFF, which adds the session token). */
export class AdminClient {
  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    readonly basePath = '/api/admin',
  ) {}

  me(signal?: AbortSignal): Promise<Me> {
    return this.get('/me', {}, signal);
  }

  updateMe(body: ProfileUpdate): Promise<Official> {
    return this.send('PUT', '/me', { body: JSON.stringify(body), contentType: 'application/json' });
  }

  /** JPEG or PNG, 2 Mio at most (checked by the caller); raw body plus `X-File-Mime-Type`. */
  uploadAvatar(file: Blob, mimeType: 'image/jpeg' | 'image/png'): Promise<Official> {
    return this.send('PUT', '/me/avatar', {
      body: file,
      contentType: 'application/octet-stream',
      headers: { 'x-file-mime-type': mimeType },
    });
  }

  avatarUrl(officialId: string): string {
    return `${this.basePath}/v1/admin/avatars/${encodeURIComponent(officialId)}`;
  }

  listAdministrations(signal?: AbortSignal): Promise<AdministrationList> {
    return this.get('/administrations', {}, signal);
  }

  listOfficials(params: ListParams, signal?: AbortSignal): Promise<OfficialPage> {
    return this.get('/officials', paging(params), signal);
  }

  /** The response carries `temporaryPassword`: never log it. */
  createOfficial(body: OfficialInput): Promise<OfficialCreated> {
    return this.send('POST', '/officials', { body: JSON.stringify(body), contentType: 'application/json' });
  }

  updateOfficial(id: string, body: OfficialUpdate): Promise<Official> {
    return this.send('PUT', `/officials/${encodeURIComponent(id)}`, {
      body: JSON.stringify(body),
      contentType: 'application/json',
    });
  }

  listCases(params: ListParams & { view: CaseView }, signal?: AbortSignal): Promise<CasePage> {
    return this.get('/cases', { ...paging(params), view: params.view }, signal);
  }

  getCase(id: string, signal?: AbortSignal): Promise<Case> {
    return this.get(`/cases/${encodeURIComponent(id)}`, {}, signal);
  }

  /** Body is exactly `{ action, note }`; one `idempotencyKey` per intent, reused on retry. */
  act(id: string, command: CaseActionInput, idempotencyKey: string): Promise<Case> {
    return this.send('POST', `/cases/${encodeURIComponent(id)}/actions`, {
      body: JSON.stringify({ action: command.action, note: command.note }),
      contentType: 'application/json',
      headers: { 'idempotency-key': idempotencyKey },
    });
  }

  documentUrl(caseId: string, documentId: string): string {
    return `${this.basePath}/v1/admin/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}`;
  }

  getDashboard(params: { administrationId?: string | null }, signal?: AbortSignal): Promise<Dashboard> {
    return this.get('/dashboard', { administrationId: params.administrationId }, signal);
  }

  listActivity(params: ListParams & { caseId?: string }, signal?: AbortSignal): Promise<ActivityPage> {
    return this.get('/activity', { ...paging(params), caseId: params.caseId }, signal);
  }

  listUnanswered(
    params: ListParams & { status?: 'open' | 'resolved' },
    signal?: AbortSignal,
  ): Promise<UnansweredPage> {
    return this.get('/unanswered', { ...paging(params), status: params.status }, signal);
  }

  resolveUnanswered(id: string): Promise<UnansweredEntry> {
    return this.send('POST', `/unanswered/${encodeURIComponent(id)}/resolve`, {});
  }

  private get<T>(path: string, query: Query, signal?: AbortSignal): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    }
    const suffix = search.size > 0 ? `?${search}` : '';
    return this.send('GET', path + suffix, { signal });
  }

  private async send<T>(
    method: 'GET' | 'PUT' | 'POST',
    path: string,
    options: { body?: BodyInit; contentType?: string; headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<T> {
    const headers: Record<string, string> = { traceparent: newTraceparent(), ...options.headers };
    if (options.contentType) headers['content-type'] = options.contentType;
    const response = await this.fetchImpl(`${this.basePath}/v1/admin${path}`, {
      method,
      headers,
      body: options.body,
      signal: options.signal,
    });
    if (!response.ok) throw await toError(response);
    return (await response.json()) as T;
  }
}

function paging({ administrationId, cursor, limit }: ListParams): Query {
  return { administrationId, cursor, limit };
}

async function toError(response: Response): Promise<AdminError> {
  let problem: Problem | undefined;
  try {
    if ((response.headers.get('content-type') ?? '').includes('json')) {
      problem = (await response.json()) as Problem;
    }
  } catch {
    problem = undefined;
  }
  return new AdminError(response.status, problem);
}

/** Shared instance for the pages (same-origin calls only). */
export const adminApi = new AdminClient();
