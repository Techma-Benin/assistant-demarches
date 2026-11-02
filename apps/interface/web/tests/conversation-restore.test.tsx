import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantApp } from '@/components/app/AssistantApp';
import { ConversationView } from '@/components/chat/ConversationView';
import { useConversation } from '@/hooks/use-conversation';
import type { C1Client } from '@/lib/c1-client';
import { noopConsent } from '@/lib/consent';
import { clearConversation, loadConversation, saveConversation, type ConversationSnapshot } from '@/lib/conversation-persistence';
import { initialState, type TimelineEntry } from '@/lib/conversation-state';

const CNV = 'cnv_' + '0'.repeat(25) + '1';
const user = (over: Record<string, unknown> = {}): TimelineEntry =>
  ({ kind: 'user', id: 'msg_1', content: { type: 'text', text: 'Bonjour' }, display: 'Bonjour', sentAt: '2026-11-01T10:00:00Z', delivery: 'received', ...over }) as TimelineEntry;
const saved = (timeline: TimelineEntry[] = [user()], over: Partial<ConversationSnapshot> = {}): ConversationSnapshot => ({
  conversationId: CNV,
  cursor: 'evt_9',
  seenEventIds: ['evt_9'],
  timeline,
  requestProcedureId: null,
  mandate: null,
  ...over,
});

function fakeClient() {
  return {
    createConversation: vi.fn(async () => ({ id: 'cnv_new' })),
    createSocketTicket: vi.fn(async () => {
      throw new Error('no socket');
    }),
    listEvents: vi.fn(async () => ({ items: [], nextCursor: null })),
    sendMessage: vi.fn(async () => ({})),
  };
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.useRealTimers());

describe('resuming after a reload', () => {
  it('skips the creation, shows the timeline at once and polls from the saved cursor', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useConversation(client as unknown as C1Client, saved()));
    expect(result.current.state).toMatchObject({ status: 'ready', conversationId: CNV });
    expect(result.current.state.timeline).toHaveLength(1);
    await waitFor(() => expect(client.listEvents).toHaveBeenCalled());
    expect((client.listEvents.mock.calls[0] as unknown[])[1]).toBe('evt_9');
    expect(client.createConversation).not.toHaveBeenCalled();
  });

  it('retries a restored failed text message with the same id', async () => {
    const client = fakeClient();
    const { result } = renderHook(() =>
      useConversation(client as unknown as C1Client, saved([user({ delivery: 'failed' })])),
    );
    act(() => result.current.retry('msg_1'));
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(1));
    expect(client.sendMessage.mock.calls[0]).toMatchObject([CNV, { id: 'msg_1', content: { type: 'text', text: 'Bonjour' } }]);
    await waitFor(() => expect(result.current.state.timeline[0]).toMatchObject({ delivery: 'accepted' }));
  });

  it('saves the conversation once it has messages', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useConversation(client as unknown as C1Client));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(loadConversation()).toBeNull();
    act(() => result.current.sendText('Salut'));
    await waitFor(() => expect(loadConversation()?.timeline).toHaveLength(1));
  });

  it('AssistantApp shows the saved conversation directly and clears storage on restart', async () => {
    saveConversation(saved());
    render(<AssistantApp initialView="conversation" />);
    expect(screen.getByRole('log')).toHaveTextContent('Bonjour');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle question' }));
    expect(loadConversation()).toBeNull();
  });

  it('keeps the restored history above a lost-conversation notice', () => {
    render(
      <ConversationView
        conversation={{
          state: { ...initialState, status: 'error', lost: true, error: 'Cette conversation n’est plus disponible.', conversationId: CNV, timeline: [user()] },
          connection: 'offline',
          sendText: vi.fn(),
          sendButton: vi.fn(),
          sendForm: vi.fn(),
          sendFile: vi.fn(),
          sendFiles: vi.fn(),
          retry: vi.fn(),
          consent: noopConsent,
        }}
        onRestart={() => {}}
      />,
    );
    expect(screen.getByRole('log')).toHaveTextContent('Bonjour');
    expect(screen.getByRole('alert')).toHaveTextContent('n’est plus disponible');
  });
});

describe('day separators', () => {
  const view = (timeline: TimelineEntry[]) =>
    render(
      <ConversationView
        conversation={{
          state: { ...initialState, status: 'ready', conversationId: CNV, timeline },
          connection: 'live',
          sendText: vi.fn(),
          sendButton: vi.fn(),
          sendForm: vi.fn(),
          sendFile: vi.fn(),
          sendFiles: vi.fn(),
          retry: vi.fn(),
          consent: noopConsent,
        }}
        onRestart={() => {}}
      />,
    );
  const agent = (createdAt: string): TimelineEntry => ({
    kind: 'agent',
    message: { id: 'a1', conversationId: CNV, blocks: [{ type: 'text', text: 'Réponse', sources: [] }], createdAt },
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 3, 15, 0));
  });

  it('labels each day when the chat spans several', () => {
    view([user({ sentAt: new Date(2026, 10, 2, 10).toISOString() }), agent(new Date(2026, 10, 3, 9).toISOString())]);
    const labels = screen.getAllByRole('separator').map((s) => s.textContent);
    expect(labels).toEqual(['Hier', 'Aujourd’hui']);
  });

  it('labels a conversation that started before today', () => {
    view([user({ sentAt: new Date(2026, 10, 1, 10).toISOString() })]);
    expect(screen.getByRole('separator')).toHaveTextContent('dimanche 1 novembre');
  });

  it('shows nothing for a conversation held entirely today', () => {
    view([user({ sentAt: new Date(2026, 10, 3, 10).toISOString() })]);
    expect(screen.queryByRole('separator')).toBeNull();
  });
});
