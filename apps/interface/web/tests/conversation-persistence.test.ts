import { beforeEach, describe, expect, it } from 'vitest';
import { clearConversation, loadConversation, saveConversation } from '@/lib/conversation-persistence';

beforeEach(() => sessionStorage.clear());

describe('conversation persistence', () => {
  it('round-trips the conversation id', () => {
    expect(loadConversation()).toBeNull();
    saveConversation({ conversationId: 'cnv_1' });
    expect(loadConversation()).toEqual({ conversationId: 'cnv_1' });
  });

  it('keeps nothing but the id: no timeline, no cursor, no content', () => {
    saveConversation({ conversationId: 'cnv_1', timeline: [{ kind: 'user', display: 'secret' }], cursor: 'evt_9' } as never);
    const raw = sessionStorage.getItem('assistant-demarches:conversation:v2')!;
    expect(JSON.parse(raw)).toEqual({ conversationId: 'cnv_1' });
    expect(raw).not.toContain('secret');
  });

  it('returns null for corrupted JSON or a wrong shape', () => {
    const key = 'assistant-demarches:conversation:v2';
    for (const raw of ['{', '[]', '"x"', '{"conversationId":""}', '{"conversationId":3}', '{}']) {
      sessionStorage.setItem(key, raw);
      expect(loadConversation()).toBeNull();
    }
  });

  it('ignores the v1 format and clears both', () => {
    sessionStorage.setItem('assistant-demarches:conversation:v1', JSON.stringify({ version: 1, conversationId: 'cnv_1' }));
    expect(loadConversation()).toBeNull();
    saveConversation({ conversationId: 'cnv_2' });
    clearConversation();
    expect(loadConversation()).toBeNull();
    expect(sessionStorage.getItem('assistant-demarches:conversation:v1')).toBeNull();
  });
});
