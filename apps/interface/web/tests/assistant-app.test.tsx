import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantApp } from '@/components/app/AssistantApp';
import { loadConversation } from '@/lib/conversation-persistence';
import { initialState, type ConversationState } from '@/lib/conversation-state';
import { fakeConversation, type Conversation } from './conversation-helper';

const hook = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/hooks/use-conversation', () => ({ useConversation: () => hook.current }));

function build(state: Partial<ConversationState>): Conversation {
  return fakeConversation({ state: { ...initialState, status: 'ready', conversationId: 'cnv_1', ...state } });
}

describe('AssistantApp', () => {
  beforeEach(() => {
    hook.current = null;
  });

  it('shows the front door until the first question and sends it through the hook', async () => {
    const conversation = build({});
    hook.current = conversation;
    render(<AssistantApp />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vos démarches, simplement.');
    await userEvent.click(screen.getByRole('button', { name: 'Renouveler mon passeport' }));
    expect(conversation.sendText).toHaveBeenCalledWith('Renouveler mon passeport');
  });

  it('sends a file from the front door through the hook', async () => {
    const conversation = build({});
    hook.current = conversation;
    const { container } = render(<AssistantApp />);
    const file = new File(['x'], 'acte.pdf', { type: 'application/pdf' });
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(conversation.sendFiles).toHaveBeenCalledWith([file], undefined);
  });

  it('never makes the front door wait for the Backend: no conversation yet, the buttons are live', async () => {
    const conversation = build({ status: 'idle', conversationId: null });
    hook.current = conversation;
    render(<AssistantApp />);
    const ask = screen.getByRole('button', { name: 'Renouveler mon passeport' });
    expect(ask).toBeEnabled();
    await userEvent.click(ask);
    expect(conversation.sendText).toHaveBeenCalledWith('Renouveler mon passeport');
  });

  it('switches to the conversation view once a question is sent', async () => {
    hook.current = build({
      timeline: [
        {
          kind: 'user',
          id: 'u1',
          content: { type: 'text', text: 'Renouveler mon passeport' },
          display: 'Renouveler mon passeport',
          sentAt: '2026-10-30T09:00:00Z',
          delivery: 'accepted',
        },
      ],
    });
    window.history.replaceState(null, '', '/');
    render(<AssistantApp />);
    await userEvent.click(screen.getByRole('button', { name: 'Renouveler mon passeport' }));
    expect(window.location.pathname).toBe('/conversation');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Conversation avec l’Assistant Démarches');
    expect(within(screen.getByRole('log')).getByText('Renouveler mon passeport')).toBeInTheDocument();
    expect(screen.getByRole('log')).toBeInTheDocument();
  });

  it('keeps the front door when the conversation fails to start, and retries once the visitor asks', async () => {
    hook.current = build({ status: 'error', conversationId: null, error: 'Impossible de démarrer la conversation. Veuillez réessayer.' });
    window.history.replaceState(null, '', '/');
    render(<AssistantApp />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vos démarches, simplement.');
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Renouveler mon passeport' }));
    expect(window.location.pathname).toBe('/conversation');
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});

describe('AssistantApp, new tab', () => {
  const stubFetch = (user: unknown, conversations: unknown) => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).startsWith('/api/session')
        ? new Response(JSON.stringify({ user }), { status: 200 })
        : new Response(JSON.stringify(conversations), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const newest = { id: 'cnv_01JD0000000000000000000009', channel: 'web', locale: 'fr', authenticated: true, createdAt: '2026-11-02T08:00:00Z', lastMessageAt: new Date(Date.now() - 5 * 60_000).toISOString() };

  beforeEach(() => {
    hook.current = build({ status: 'idle', conversationId: null });
    window.sessionStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('offers the newest conversation of a signed-in person, and resumes it', async () => {
    const fetchMock = stubFetch({ name: 'Awa', roles: [] }, { items: [newest], nextCursor: null });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<AssistantApp />);
    expect(await screen.findByText(/Conversation en cours/, undefined, { timeout: 4000 })).toHaveTextContent('il y a 5 min');
    expect(String(fetchMock.mock.calls.find(([url]) => String(url).includes('/v1/conversations'))![0])).toContain('limit=1');
    await userEvent.click(screen.getByRole('button', { name: 'Reprendre' }));
    expect(loadConversation()).toEqual({ conversationId: newest.id });
    expect(assign).toHaveBeenCalledWith('/conversation');
  });

  it('falls back to the creation time when lastMessageAt is missing', async () => {
    const createdAt = new Date(Date.now() - 10 * 60_000).toISOString();
    stubFetch({ name: 'Awa', roles: [] }, { items: [{ ...newest, createdAt, lastMessageAt: null }], nextCursor: null });
    render(<AssistantApp />);
    expect(await screen.findByText(/Conversation en cours/, undefined, { timeout: 4000 })).toHaveTextContent('il y a 10 min');
  });

  it('never asks the Backend for conversations when the visitor is a guest', async () => {
    const fetchMock = stubFetch(null, { items: [newest], nextCursor: null });
    render(<AssistantApp />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/session'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v1/conversations'))).toBe(false);
    expect(screen.queryByText(/Conversation en cours/)).toBeNull();
  });
});
