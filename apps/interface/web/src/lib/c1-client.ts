import type { Schemas } from '@techma/contracts-ts';
import type { ContractMimeType } from './files';
import { newTraceparent } from './trace';

export type ConversationInput = Schemas['ConversationInput'];
export type Conversation = Schemas['Conversation'];
export type MessageInput = Schemas['MessageInput'];
export type MessageAccepted = Schemas['MessageAccepted'];
export type EventPage = Schemas['EventPage'];
export type ConversationEvent = Schemas['Event'];
export type SocketTicket = Schemas['SocketTicket'];
export type Problem = Schemas['Problem'];
export type Challenge = Schemas['Challenge'];
export type ConsentInput = Schemas['ConsentInput'];
export type Mandate = Schemas['Mandate'];
export type UploadedFile = Schemas['File'];
export type Case = Schemas['Case'];
export type CasePage = Schemas['CasePage'];

export class C1Error extends Error {
  readonly status: number;
  readonly problem?: Problem;
  readonly retryAfterSeconds?: number;

  constructor(status: number, problem?: Problem, retryAfterSeconds?: number) {
    super(problem?.detail ?? `Erreur C1 (HTTP ${status})`);
    this.name = 'C1Error';
    this.status = status;
    this.problem = problem;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Download URL of an issued document (the proxy injects the token). */
export function caseDocumentHref(caseId: string, documentId: string, basePath = '/api/backend'): string {
  return `${basePath}/v1/cases/${caseId}/documents/${documentId}`;
}

export class C1Client {
  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    readonly basePath = '/api/backend',
  ) {}

  createConversation(input: ConversationInput, idempotencyKey: string): Promise<Conversation> {
    return this.request('POST', '/v1/conversations', { body: input, idempotencyKey });
  }

  sendMessage(conversationId: string, input: MessageInput, signal?: AbortSignal): Promise<MessageAccepted> {
    return this.request('POST', `/v1/conversations/${conversationId}/messages`, {
      body: input,
      idempotencyKey: input.id,
      signal,
    });
  }

  listEvents(conversationId: string, cursor?: string | null, signal?: AbortSignal): Promise<EventPage> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.request('GET', `/v1/conversations/${conversationId}/events${query}`, { signal });
  }

  // Single-use ticket (60 s): every call needs a NEW Idempotency-Key, or a consumed ticket is replayed.
  createSocketTicket(conversationId: string, idempotencyKey: string): Promise<SocketTicket> {
    return this.request('POST', `/v1/conversations/${conversationId}/socket-ticket`, { idempotencyKey });
  }

  // The challenge comes from a `consent` block (built by the Backend). Stable key `consent-<challengeId>` so a retry replays.
  createMandate(conversationId: string, consent: ConsentInput, idempotencyKey: string): Promise<Mandate> {
    return this.request('POST', `/v1/conversations/${conversationId}/mandates`, { body: consent, idempotencyKey });
  }

  revokeMandate(conversationId: string, mandateId: string, idempotencyKey: string): Promise<Mandate> {
    return this.request('POST', `/v1/conversations/${conversationId}/mandates/${mandateId}/revoke`, { idempotencyKey });
  }

  listCases(cursor?: string | null, signal?: AbortSignal): Promise<CasePage> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.request('GET', `/v1/cases${query}`, { signal });
  }

  getCase(caseId: string, signal?: AbortSignal): Promise<Case> {
    return this.request('GET', `/v1/cases/${caseId}`, { signal });
  }

  uploadFile(body: Blob, mimeType: ContractMimeType, idempotencyKey: string, signal?: AbortSignal): Promise<UploadedFile> {
    return this.request('POST', '/v1/files', {
      rawBody: body,
      headers: { 'content-type': 'application/octet-stream', 'x-file-mime-type': mimeType },
      idempotencyKey,
      signal,
    });
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: {
      body?: unknown;
      rawBody?: Blob;
      headers?: Record<string, string>;
      idempotencyKey?: string;
      signal?: AbortSignal;
    },
  ): Promise<T> {
    const headers: Record<string, string> = { traceparent: newTraceparent(), ...options.headers };
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const response = await this.fetchImpl(this.basePath + path, {
      method,
      headers,
      body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
      signal: options.signal,
    });
    if (!response.ok) throw await toError(response);
    return (await response.json()) as T;
  }
}

async function toError(response: Response): Promise<C1Error> {
  let problem: Problem | undefined;
  try {
    if ((response.headers.get('content-type') ?? '').includes('json')) {
      problem = (await response.json()) as Problem;
    }
  } catch {
    problem = undefined;
  }
  const retryAfter = Number(response.headers.get('retry-after'));
  return new C1Error(
    response.status,
    problem,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}
