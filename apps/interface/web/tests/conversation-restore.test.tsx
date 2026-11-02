import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantApp } from '@/components/app/AssistantApp';
import { ConversationView } from '@/components/chat/ConversationView';
import { useConversation } from '@/hooks/use-conversation';
import type { C1Client } from '@/lib/c1-client';
import { loadConversation, saveConversation } from '@/lib/conversation-persistence';
import { initialState, type TimelineEntry } from '@/lib/conversation-state';
import { fakeConversation } from './conversation-helper';
import { CONVERSATION_ID as CNV, agentEvent, textBlock, userEvent as userEventFixture } from './fixtures-v2';

const user = (over: Record<string, unknown> = {}): TimelineEntry =>
  ({ kind: 'user', id: 'msg_1', content: { type: 'text', text: 'Bonjour' }, display: 'Bonjour', sentAt: '2026-11-01T10:00:00Z', delivery: 'received', ...over }) as TimelineEntry;

/** A fake Backend whose history already holds one exchange (the visitor reloaded the page). */
function fakeClient(history = [userEventFixture(1, { type: 'text', text: 'Comment obtenir mon casier ?' }), agentEvent(2, [textBlock('Voici la marche à suivre.')])]) {
  let served = false;
  return {
    createConversation: vi.fn(async () => ({ id: 'cnv_new' })),
    createSocketTicket: vi.fn(async () => {
      throw new Error('no socket');
    }),
    listEvents: vi.fn(async () => {
      if (served) return { items: [], nextCursor: null };
      served = true;
      return { items: history, nextCursor: null };
    }),
    sendMessage: vi.fn(async () => ({})),
  };
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.useRealTimers());

describe('resuming after a reload', () => {
  it('rebuilds the timeline from the whole history: no cursor, no new conversation', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useConversation(client as unknown as C1Client, { conversationId: CNV }));
    expect(result.current.state).toMatchObject({ status: 'ready', conversationId: CNV });
    expect(result.current.loadingHistory).toBe(true);
    await waitFor(() => expect(result.current.state.timeline).toHaveLength(2));
    expect(result.current.loadingHistory).toBe(false);
    expect((client.listEvents.mock.calls[0] as unknown[])[1]).toBeNull();
    expect(client.createConversation).not.toHaveBeenCalled();
    expect(result.current.state.timeline[0]).toMatchObject({ kind: 'user', display: 'Comment obtenir mon casier ?', delivery: 'received' });
    expect(result.current.state.timeline[1]).toMatchObject({ kind: 'agent' });
  });

  it('rebuilds a voice message with its transcript', async () => {
    const client = fakeClient([userEventFixture(1, { type: 'audio', fileId: 'fil_' + '0'.repeat(26) }, { transcript: 'Je veux un acte de naissance' })]);
    const { result } = renderHook(() => useConversation(client as unknown as C1Client, { conversationId: CNV }));
    await waitFor(() => expect(result.current.state.timeline).toHaveLength(1));
    expect(result.current.state.timeline[0]).toMatchObject({ transcript: { status: 'done', text: 'Je veux un acte de naissance' } });
  });

  it('retries a failed text message with the same id', async () => {
    const client = fakeClient([]);
    client.sendMessage.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useConversation(client as unknown as C1Client, { conversationId: CNV }));
    act(() => result.current.sendText('Bonjour'));
    const id = (result.current.state.timeline[0] as { id: string }).id;
    await waitFor(() => expect(result.current.state.timeline[0]).toMatchObject({ delivery: 'failed' }));
    act(() => result.current.retry(id));
    await waitFor(() => expect(result.current.state.timeline[0]).toMatchObject({ delivery: 'accepted' }));
    expect(client.sendMessage).toHaveBeenCalledTimes(2);
    expect(client.sendMessage.mock.calls[1]).toMatchObject([CNV, { id, content: { type: 'text', text: 'Bonjour' } }]);
  });

  it('saves only the conversation id, never the timeline', async () => {
    const client = fakeClient([]);
    const { result } = renderHook(() => useConversation(client as unknown as C1Client));
    expect(loadConversation()).toBeNull();
    act(() => result.current.sendText('Salut'));
    await waitFor(() => expect(loadConversation()).toEqual({ conversationId: 'cnv_new' }));
    const raw = JSON.parse(sessionStorage.getItem('assistant-demarches:conversation:v2')!);
    expect(Object.keys(raw)).toEqual(['conversationId']);
    expect(JSON.stringify(sessionStorage)).not.toContain('Salut');
  });

  it('AssistantApp shows the history of the saved conversation and clears storage on restart', async () => {
    saveConversation({ conversationId: CNV });
    const history = [userEventFixture(1, { type: 'text', text: 'Comment obtenir mon casier ?' }), agentEvent(2, [textBlock('Voici la marche à suivre.')])];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/events')
          ? new Response(JSON.stringify({ items: history, nextCursor: null }), { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response('{}', { status: 500 }),
      ),
    );
    render(<AssistantApp initialView="conversation" />);
    await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('Comment obtenir mon casier ?'));
    expect(screen.getByRole('log')).toHaveTextContent('Voici la marche à suivre.');
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle question' }));
    expect(loadConversation()).toBeNull();
    vi.unstubAllGlobals();
  });

  it('keeps the restored history above a lost-conversation notice', () => {
    render(
      <ConversationView
        conversation={fakeConversation({
          state: { ...initialState, status: 'error', lost: true, error: 'Cette conversation n’est plus disponible.', conversationId: CNV, timeline: [user()] },
          connection: 'offline',
        })}
        onRestart={() => {}}
      />,
    );
    expect(screen.getByRole('log')).toHaveTextContent('Bonjour');
    expect(screen.getByRole('alert')).toHaveTextContent('n’est plus disponible');
  });

  it('shows no greeting while the history of a resumed conversation loads', () => {
    render(
      <ConversationView
        conversation={fakeConversation({ loadingHistory: true, state: { ...initialState, status: 'ready', conversationId: CNV } })}
        onRestart={() => {}}
      />,
    );
    expect(screen.queryByText('Bonjour !')).toBeNull();
  });
});

describe('day separators', () => {
  const view = (timeline: TimelineEntry[]) =>
    render(
      <ConversationView
        conversation={fakeConversation({ state: { ...initialState, status: 'ready', conversationId: CNV, timeline } })}
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
