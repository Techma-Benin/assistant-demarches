import { MAX_MEDIA_BYTES, MediaTooLargeError, MetaPermanentError, MetaRetryableError, type MetaMedia, type MetaSender } from './meta.js';
import type { OutboundMessage } from '../rendering/types.js';

const GRAPH_BASE = 'https://graph.facebook.com';
const SEND_TIMEOUT_MS = 10_000;
const MEDIA_TIMEOUT_MS = 30_000;

export interface GraphApiOptions {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

function classify(status: number): MetaRetryableError | MetaPermanentError {
  return status === 429 || status >= 500 ? new MetaRetryableError(status) : new MetaPermanentError(status);
}

/** Envoi réel via l’API Graph. Configuré mais non exercé en direct (pas de compte Meta). */
export class GraphApiMetaSender implements MetaSender {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(private readonly options: GraphApiOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.base = options.baseUrl ?? GRAPH_BASE;
  }

  async send(to: string, message: OutboundMessage): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}/${this.options.graphVersion}/${this.options.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.options.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      throw new MetaRetryableError();
    }
    // Le corps de la réponse n’est jamais journalisé ni conservé.
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw classify(response.status);
  }
}

/** Téléchargement en deux temps : métadonnées (url, file_size) puis octets. */
export class GraphApiMetaMedia implements MetaMedia {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(
    private readonly options: Omit<GraphApiOptions, 'phoneNumberId'>,
    private readonly maxBytes = MAX_MEDIA_BYTES,
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.base = options.baseUrl ?? GRAPH_BASE;
  }

  private async get(url: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.options.accessToken}` },
        signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
      });
    } catch {
      throw new MetaRetryableError();
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw classify(response.status);
    }
    return response;
  }

  async download(mediaId: string): Promise<Buffer> {
    const metaResponse = await this.get(`${this.base}/${this.options.graphVersion}/${encodeURIComponent(mediaId)}`);
    const meta = (await metaResponse.json().catch(() => undefined)) as { url?: unknown; file_size?: unknown } | undefined;
    if (!meta || typeof meta.url !== 'string') throw new MetaPermanentError();
    if (typeof meta.file_size === 'number' && meta.file_size > this.maxBytes) throw new MediaTooLargeError();

    const response = await this.get(meta.url);
    if (!response.body) throw new MetaPermanentError();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > this.maxBytes) {
          await reader.cancel();
          throw new MediaTooLargeError();
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof MediaTooLargeError) throw error;
      throw new MetaRetryableError();
    }
    return Buffer.concat(chunks);
  }
}
