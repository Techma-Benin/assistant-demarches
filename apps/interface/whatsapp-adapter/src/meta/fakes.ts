import { MAX_MEDIA_BYTES, MediaTooLargeError, MetaPermanentError, type MetaMedia, type MetaSender } from './meta.js';
import type { OutboundMessage } from '../rendering/types.js';

export interface RecordedMessage {
  to: string;
  message: OutboundMessage;
  at: string;
}

/** Dev/tests : enregistre les envois en mémoire, aucun appel réseau. */
export class RecordingMetaSender implements MetaSender {
  private readonly records: RecordedMessage[] = [];

  async send(to: string, message: OutboundMessage): Promise<void> {
    this.records.push({ to, message, at: new Date().toISOString() });
  }

  list(): readonly RecordedMessage[] {
    return this.records;
  }

  clear(): void {
    this.records.length = 0;
  }
}

/** Dev/tests : renvoie les octets enregistrés par identifiant de média. */
export class FakeMetaMedia implements MetaMedia {
  private readonly media = new Map<string, Buffer>();

  constructor(private readonly maxBytes = MAX_MEDIA_BYTES) {}

  register(mediaId: string, bytes: Uint8Array): void {
    this.media.set(mediaId, Buffer.from(bytes));
  }

  async download(mediaId: string): Promise<Buffer> {
    const bytes = this.media.get(mediaId);
    if (!bytes) throw new MetaPermanentError(404);
    if (bytes.length > this.maxBytes) throw new MediaTooLargeError();
    return bytes;
  }
}

/** `+229••••••12` : garde les 4 premiers et les 2 derniers caractères du numéro préfixé de « + ». */
export function maskPhone(to: string): string {
  const full = `+${to}`;
  if (full.length <= 6) return '•'.repeat(full.length);
  return full.slice(0, 4) + '•'.repeat(full.length - 6) + full.slice(-2);
}
