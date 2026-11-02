import { vi } from 'vitest';
import type { useConversation } from '@/hooks/use-conversation';
import { noopConsent } from '@/lib/consent';
import { initialState } from '@/lib/conversation-state';

export type Conversation = ReturnType<typeof useConversation>;

/** A `useConversation` result for rendering ConversationView: ready, live, nothing sent. */
export function fakeConversation(over: Partial<Conversation> = {}): Conversation {
  return {
    state: { ...initialState, status: 'ready', conversationId: 'cnv_' + '0'.repeat(25) + '1' },
    connection: 'live',
    loadingHistory: false,
    sendText: vi.fn(),
    sendButton: vi.fn(),
    sendForm: vi.fn(),
    sendFile: vi.fn(),
    sendFiles: vi.fn(),
    retry: vi.fn(),
    consent: noopConsent,
    ...over,
  };
}
