import type { components } from '@techma/contracts-ts';
import { newTraceparent } from './trace';

type Schemas = components['schemas'];
export type ConversationInput = Schemas['ConversationInput'];
export type Conversation = Schemas['Conversation'];
export type MessageInput = Schemas['MessageInput'];
export type MessageAccepted = Schemas['MessageAccepted'];
export type EventPage = Schemas['EventPage'];
export type Problem = Schemas['Problem'];

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

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; idempotencyKey?: string; signal?: AbortSignal },
  ): Promise<T> {
    const headers: Record<string, string> = { traceparent: newTraceparent() };
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const response = await this.fetchImpl(this.basePath + path, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
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
