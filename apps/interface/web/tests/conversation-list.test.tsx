import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationList } from '@/components/app/ConversationList';
import { C1Error, type C1Client, type Conversation } from '@/lib/c1-client';
import { loadConversation } from '@/lib/conversation-persistence';
import { CONVERSATION_ID, agentEvent, textBlock, userEvent as received } from './fixtures-v2';

const conv = (n: number, over: Partial<Conversation> = {}): Conversation => ({
  id: `cnv_0${String(n).padStart(25, '0')}` as Conversation['id'],
  channel: 'web',
  locale: 'fr',
  authenticated: true,
  createdAt: '2026-11-02T08:00:00Z',
  lastMessageAt: '2026-11-02T09:00:00Z',
  ...over,
} as Conversation);

const events = (...items: unknown[]) => ({ items, nextCursor: null });
const client = (parts: Record<string, unknown>) => parts as unknown as C1Client;

beforeEach(() => window.sessionStorage.clear());

describe('ConversationList', () => {
  it('lists conversations with a title taken from the first message, hiding empty ones', async () => {
    // lastMessageAt may be null even with messages (Backend): only a history without any message hides a conversation.
    const [a, b, c, empty] = [conv(1), conv(2), conv(3, { lastMessageAt: null }), conv(4, { lastMessageAt: null })];
    const long = 'x'.repeat(120);
    const byId: Record<string, unknown> = {
      [a.id]: events(agentEvent(1, [textBlock('Bonjour')]), received(2, { type: 'text', text: 'Casier judiciaire ?' })),
      [b.id]: events(received(1, { type: 'audio', fileId: 'fil_01JD0000000000000000000001' as never })),
      [c.id]: events(received(1, { type: 'text', text: long })),
      [empty.id]: events(),
    };
    const c1 = client({
      listConversations: vi.fn(async () => ({ items: [a, b, c, empty], nextCursor: null })),
      listEvents: vi.fn(async (id: string) => byId[id]),
    });
    render(<ConversationList client={c1} />);
    const list = await screen.findByRole('list', { name: 'Vos conversations' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
    const items = within(list).getAllByRole('listitem');
    await waitFor(() => expect(items[0]).toHaveTextContent('Casier judiciaire ?'));
    expect(items[1]).toHaveTextContent('Message vocal');
    expect(items[2]).toHaveTextContent(`${'x'.repeat(79)}…`);
    expect(items[0]).toHaveTextContent(/Dernier message /);
    expect(items[2]).toHaveTextContent(/Commencée /);
    expect(c1.listConversations).toHaveBeenCalledWith(null, 10);
    expect(CONVERSATION_ID).toBeTruthy();
  });

  it('falls back to the date while the title loads or when it fails', async () => {
    const c1 = client({
      listConversations: vi.fn(async () => ({ items: [conv(1)], nextCursor: null })),
      listEvents: vi.fn(async () => Promise.reject(new C1Error(500))),
    });
    render(<ConversationList client={c1} />);
    expect(await screen.findByText(/^Conversation du 02\/11\/2026 à /)).toBeInTheDocument();
  });

  it('asks for at most three titles at a time', async () => {
    let active = 0;
    let peak = 0;
    const c1 = client({
      listConversations: vi.fn(async () => ({ items: [1, 2, 3, 4, 5, 6].map((n) => conv(n)), nextCursor: null })),
      listEvents: vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return events(received(1, { type: 'text', text: 'Q' }));
      }),
    });
    render(<ConversationList client={c1} />);
    await waitFor(() => expect(c1.listEvents).toHaveBeenCalledTimes(6));
    await waitFor(() => expect(active).toBe(0));
    expect(peak).toBe(3);
  });

  it('saves the id and navigates on « Reprendre »', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const item = conv(7);
    render(<ConversationList client={client({ listConversations: vi.fn(async () => ({ items: [item], nextCursor: null })), listEvents: vi.fn(async () => events(received(1, { type: 'text', text: 'Q' }))) })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reprendre' }));
    expect(loadConversation()).toEqual({ conversationId: item.id });
    expect(assign).toHaveBeenCalledWith('/conversation');
    vi.unstubAllGlobals();
  });

  it('loads the next page with the cursor', async () => {
    const listConversations = vi
      .fn()
      .mockResolvedValueOnce({ items: [conv(1)], nextCursor: 'C2' })
      .mockResolvedValueOnce({ items: [conv(2)], nextCursor: null });
    render(<ConversationList client={client({ listConversations, listEvents: vi.fn(async () => events(received(1, { type: 'text', text: 'Q' }))) })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Voir plus' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(listConversations).toHaveBeenLastCalledWith('C2', 10);
    expect(screen.queryByRole('button', { name: 'Voir plus' })).toBeNull();
  });

  it('says so when there is none, and offers to retry after a failure', async () => {
    const { unmount } = render(<ConversationList client={client({ listConversations: vi.fn(async () => ({ items: [], nextCursor: null })) })} />);
    expect(await screen.findByText('Aucune conversation pour le moment.')).toBeInTheDocument();
    unmount();
    const listConversations = vi.fn().mockRejectedValueOnce(new C1Error(503)).mockResolvedValue({ items: [conv(1)], nextCursor: null });
    render(<ConversationList client={client({ listConversations, listEvents: vi.fn(async () => events(received(1, { type: 'text', text: 'Q' }))) })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('list', { name: 'Vos conversations' })).toBeInTheDocument();
  });
});
