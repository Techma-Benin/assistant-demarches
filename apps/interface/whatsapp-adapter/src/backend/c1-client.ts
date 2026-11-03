import type { ContractFile, MessageInput, Problem } from '../contracts/types.js';

export class C1Error extends Error {
  /** `status` 0 = erreur réseau ou délai dépassé. */
  constructor(
    readonly status: number,
    readonly problem?: Problem,
  ) {
    super(`C1 ${status}`);
    this.name = 'C1Error';
  }

  get code(): string | undefined {
    return this.problem?.code;
  }

  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface C1Context {
  /** Jeton Backend de l’usager (voir SubjectTokenProvider). */
  token: string;
  traceparent: string;
}

export interface C1Client {
  createConversation(ctx: C1Context, input: { channel: 'whatsapp'; locale: 'fr' }, key: string): Promise<{ id: string }>;
  sendMessage(ctx: C1Context, conversationId: string, input: MessageInput): Promise<void>;
  uploadFile(ctx: C1Context, bytes: Uint8Array, mimeType: string, key: string): Promise<ContractFile>;
}

const TIMEOUT_MS = 15_000;

export class HttpC1Client implements C1Client {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(
    ctx: C1Context,
    path: string,
    init: { method: 'POST'; key: string; headers?: Record<string, string>; body: string | Uint8Array },
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${ctx.token}`,
          traceparent: ctx.traceparent,
          'Idempotency-Key': init.key,
          ...init.headers,
        },
        body: init.body as BodyInit,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new C1Error(0);
    }
    const text = await response.text().catch(() => '');
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      const problem = (json && typeof json === 'object' ? (json as Problem) : undefined) ?? undefined;
      throw new C1Error(response.status, problem);
    }
    return json;
  }

  async createConversation(ctx: C1Context, input: { channel: 'whatsapp'; locale: 'fr' }, key: string) {
    const out = (await this.call(ctx, '/v1/conversations', {
      method: 'POST',
      key,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })) as { id?: unknown } | undefined;
    if (typeof out?.id !== 'string' || !/^cnv_[0-9A-HJKMNP-TV-Z]{26}$/.test(out.id)) throw new C1Error(502);
    return { id: out.id };
  }

  async sendMessage(ctx: C1Context, conversationId: string, input: MessageInput): Promise<void> {
    await this.call(ctx, `/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      key: input.id,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async uploadFile(ctx: C1Context, bytes: Uint8Array, mimeType: string, key: string): Promise<ContractFile> {
    const out = (await this.call(ctx, '/v1/files', {
      method: 'POST',
      key,
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Mime-Type': mimeType },
      body: bytes,
    })) as ContractFile | undefined;
    if (!out || typeof out.id !== 'string') throw new C1Error(502);
    return out;
  }
}
