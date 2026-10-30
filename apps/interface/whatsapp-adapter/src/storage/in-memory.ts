import type {
  ButtonIdMap,
  ConversationDirectory,
  DedupeResult,
  DedupeStore,
  FormSessionStore,
} from './stores.js';
import { BUTTON_MAP_TTL_MS, FORM_SESSION_TTL_MS } from './stores.js';
import { TtlMap, type Clock } from './ttl-map.js';
import type { FormSession } from '../rendering/types.js';

export class InMemoryDedupeStore implements DedupeStore {
  private readonly seen: TtlMap<string>;

  constructor(now: Clock = Date.now) {
    this.seen = new TtlMap(now);
  }

  async check(key: string, digest: string, ttlMs: number): Promise<DedupeResult> {
    const previous = this.seen.get(key);
    if (previous === undefined) {
      this.seen.set(key, digest, ttlMs);
      return 'new';
    }
    return previous === digest ? 'duplicate' : 'conflict';
  }
}

export class InMemoryConversationDirectory implements ConversationDirectory {
  private readonly bySubject = new Map<string, string>();
  private readonly waIdByConversation = new Map<string, string>();

  async getBySubject(subjectKey: string): Promise<string | undefined> {
    return this.bySubject.get(subjectKey);
  }

  async getWaIdByConversation(conversationId: string): Promise<string | undefined> {
    return this.waIdByConversation.get(conversationId);
  }

  async save(subjectKey: string, waId: string, conversationId: string): Promise<void> {
    this.bySubject.set(subjectKey, conversationId);
    this.waIdByConversation.set(conversationId, waId);
  }
}

export class InMemoryFormSessionStore implements FormSessionStore {
  private readonly sessions: TtlMap<FormSession>;

  constructor(now: Clock = Date.now) {
    this.sessions = new TtlMap(now);
  }

  async get(conversationId: string): Promise<FormSession | undefined> {
    return this.sessions.get(conversationId);
  }

  async set(conversationId: string, session: FormSession): Promise<void> {
    this.sessions.set(conversationId, structuredClone(session), FORM_SESSION_TTL_MS);
  }

  async clear(conversationId: string): Promise<void> {
    this.sessions.delete(conversationId);
  }
}

export class InMemoryButtonIdMap implements ButtonIdMap {
  private readonly map: TtlMap<string>;

  constructor(now: Clock = Date.now) {
    this.map = new TtlMap(now);
  }

  async remember(conversationId: string, mapping: Record<string, string>): Promise<void> {
    for (const [shortId, original] of Object.entries(mapping))
      this.map.set(`${conversationId}|${shortId}`, original, BUTTON_MAP_TTL_MS);
  }

  async resolve(conversationId: string, replyId: string): Promise<string> {
    return this.map.get(`${conversationId}|${replyId}`) ?? replyId;
  }
}
