import type { OutboundMessage } from '../rendering/types.js';

export class MetaRetryableError extends Error {
  readonly retryable = true;
  constructor(readonly status?: number) {
    super(`Meta temporairement indisponible${status ? ` (${status})` : ''}`);
    this.name = 'MetaRetryableError';
  }
}

export class MetaPermanentError extends Error {
  readonly retryable = false;
  constructor(readonly status?: number) {
    super(`Meta a refusé la requête${status ? ` (${status})` : ''}`);
    this.name = 'MetaPermanentError';
  }
}

export class MediaTooLargeError extends Error {
  readonly retryable = false;
  constructor() {
    super('Média trop volumineux');
    this.name = 'MediaTooLargeError';
  }
}

export interface MetaSender {
  send(to: string, message: OutboundMessage): Promise<void>;
}

export interface MetaMedia {
  /** Télécharge un média ; refuse au-delà de `maxBytes` (MediaTooLargeError). */
  download(mediaId: string): Promise<Buffer>;
}

export const MAX_MEDIA_BYTES = 10_485_760;
