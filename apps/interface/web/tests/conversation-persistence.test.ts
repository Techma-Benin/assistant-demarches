import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UPLOAD_INTERRUPTED,
  clearConversation,
  loadConversation,
  saveConversation,
  type ConversationSnapshot,
} from '@/lib/conversation-persistence';
import type { TimelineEntry } from '@/lib/conversation-state';

const KEY = 'assistant-demarches:conversation:v1';
const user = (over: Record<string, unknown>): TimelineEntry =>
  ({ kind: 'user', id: 'm1', content: { type: 'text', text: 'Bonjour' }, display: 'Bonjour', sentAt: '2026-11-01T10:00:00Z', delivery: 'accepted', ...over }) as TimelineEntry;
const snapshot = (timeline: TimelineEntry[], over: Partial<ConversationSnapshot> = {}): ConversationSnapshot => ({
  conversationId: 'cnv_1',
  cursor: 'evt_2',
  seenEventIds: ['evt_1', 'evt_2'],
  timeline,
  requestProcedureId: null,
  mandate: null,
  ...over,
});

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('conversation persistence', () => {
  it('round-trips a snapshot, mandate included', () => {
    const snap = snapshot([user({})], { mandate: { id: 'mdt_1', expiresAt: '2026-11-02T00:00:00Z' } });
    saveConversation(snap);
    expect(loadConversation()).toEqual(snap);
  });

  it('returns null for nothing, corrupted JSON, a wrong version or a wrong shape', () => {
    expect(loadConversation()).toBeNull();
    sessionStorage.setItem(KEY, '{nope');
    expect(loadConversation()).toBeNull();
    saveConversation(snapshot([user({})]));
    sessionStorage.setItem(KEY, sessionStorage.getItem(KEY)!.replace('"version":1', '"version":2'));
    expect(loadConversation()).toBeNull();
    sessionStorage.setItem(KEY, JSON.stringify({ version: 1, conversationId: 'c', timeline: [{ kind: 'x' }] }));
    expect(loadConversation()).toBeNull();
  });

  it('never throws when the storage does', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => saveConversation(snapshot([user({})]))).not.toThrow();
    expect(loadConversation()).toBeNull();
    expect(() => clearConversation()).not.toThrow();
  });

  it('strips blob preview URLs', () => {
    const attachment = { name: 'a.png', sizeBytes: 1, mimeType: 'image/png', previewUrl: 'blob:x' };
    saveConversation(snapshot([user({ attachment })]));
    expect(sessionStorage.getItem(KEY)).not.toContain('blob:x');
    const entry = loadConversation()!.timeline[0];
    expect(entry.kind === 'user' && entry.attachment).toEqual({ name: 'a.png', sizeBytes: 1, mimeType: 'image/png' });
  });

  it('restores interrupted sends: text becomes failed, uploads become non-retryable failures', () => {
    saveConversation(
      snapshot([
        user({ id: 'a', delivery: 'sending' }),
        user({ id: 'b', content: null, delivery: 'uploading', attachment: { name: 'a.pdf', sizeBytes: 1, mimeType: 'application/pdf' } }),
        user({ id: 'c', delivery: 'accepted' }),
      ]),
    );
    const [a, b, c] = loadConversation()!.timeline;
    expect(a).toMatchObject({ delivery: 'failed' });
    expect(b).toMatchObject({ delivery: 'uploadFailed', error: UPLOAD_INTERRUPTED, retryable: false });
    expect(c).toMatchObject({ delivery: 'accepted' });
  });

  it('drops the oldest seen event ids when too big, and clears', () => {
    const ids = Array.from({ length: 60000 }, (_, i) => `evt_${String(i).padStart(30, '0')}`);
    saveConversation(snapshot([user({})], { seenEventIds: ids }));
    const loaded = loadConversation()!;
    expect(loaded.seenEventIds.length).toBeLessThan(ids.length);
    expect(loaded.seenEventIds.at(-1)).toBe(ids.at(-1));
    clearConversation();
    expect(loadConversation()).toBeNull();
  });
});

describe('request entry persistence', () => {
  it('round-trips a request entry', () => {
    const entry = {
      kind: 'request',
      id: 'evt_1',
      at: '2026-11-01T10:00:00Z',
      request: { id: 'req_1', conversationId: 'cnv_1', userRef: 'u', procedureId: 'p', status: 'draft', fields: {}, fileIds: [], officialLink: null, updatedAt: '2026-11-01T10:00:00Z' },
    } as TimelineEntry;
    const snap = snapshot([user({}), entry]);
    saveConversation(snap);
    expect(loadConversation()).toEqual(snap);
  });
});
