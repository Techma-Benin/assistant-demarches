import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@techma/contracts-ts';
import { describe, expect, it, vi } from 'vitest';
import { ConversationView } from '@/components/chat/ConversationView';
import type { useConversation } from '@/hooks/use-conversation';
import { initialState, type ConversationState, type TimelineEntry } from '@/lib/conversation-state';

type Block = components['schemas']['Block'];
type Conversation = ReturnType<typeof useConversation>;

const at = '2026-10-22T18:00:00Z';
const user = (id: string, display: string, delivery: 'received' | 'failed' | 'accepted' = 'received'): TimelineEntry => ({
  kind: 'user',
  id,
  content: { type: 'text', text: display },
  display,
  sentAt: at,
  delivery,
});
const agent = (id: string, ...blocks: Block[]): TimelineEntry => ({
  kind: 'agent',
  message: { id, conversationId: 'cnv_1', blocks, createdAt: at },
});
const source = (procedureId: string, url: string) => ({ procedureId, url, retrievedAt: at, version: 'v3' });

function build(state: Partial<ConversationState>, overrides: Partial<Conversation> = {}): Conversation {
  return {
    state: { ...initialState, status: 'ready', conversationId: 'cnv_1', ...state },
    connection: 'live',
    sendText: vi.fn(),
    sendButton: vi.fn(),
    sendForm: vi.fn(),
    sendFile: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}
const view = (conversation: Conversation, onRestart = () => {}) =>
  render(<ConversationView conversation={conversation} onRestart={onRestart} />);

describe('ConversationView', () => {
  it('shows the first question as the only h1 and later messages as bubbles', () => {
    view(
      build({
        timeline: [
          user('u1', 'Comment obtenir un casier judiciaire ?'),
          agent('a1', { type: 'text', text: 'Réponse', sources: [] }),
          user('u2', 'Préparer ma demande'),
        ],
      }),
    );
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent('Comment obtenir un casier judiciaire ?');
    const bubble = screen.getByText('Préparer ma demande');
    expect(bubble.tagName).not.toBe('H1');
    expect(bubble).toHaveClass('bg-sunken');
  });

  it('keeps the log region and the delivery states, with retry', async () => {
    const retry = vi.fn();
    view(build({ timeline: [user('u1', 'Question', 'failed')] }, { retry }));
    expect(screen.getByRole('log', { name: 'Conversation' })).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Échec de l’envoi')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(retry).toHaveBeenCalledWith('u1');
  });

  it('shows the sources of the last text block in the side panel', () => {
    view(
      build({
        timeline: [
          user('u1', 'Question'),
          agent('a1', { type: 'text', text: 'Ancienne', sources: [source('ancienne-fiche', 'https://old.example/a')] }),
          agent(
            'a2',
            { type: 'text', text: 'Récente', sources: [source('casier-judiciaire', 'https://service-public.example/c')] },
            { type: 'buttons', items: [{ id: 'go', label: 'Continuer' }] },
          ),
        ],
      }),
    );
    const panel = screen.getByRole('heading', { name: 'Sources' }).closest('section')!;
    expect(within(panel).getByText('casier-judiciaire')).toBeInTheDocument();
    expect(within(panel).getByText(/service-public\.example · v3/)).toBeInTheDocument();
    expect(within(panel).getByText('Consultée le 22/10/2026')).toBeInTheDocument();
    expect(within(panel).queryByText('ancienne-fiche')).toBeNull();
  });

  it('hides the sources panel when the last text block has none', () => {
    view(build({ timeline: [user('u1', 'Q'), agent('a1', { type: 'text', text: 'R', sources: [] })] }));
    expect(screen.queryByRole('heading', { name: 'Sources' })).toBeNull();
  });

  it('shows the dossier steps and an accordion toggle for small screens', async () => {
    view(build({ timeline: [user('u1', 'Q'), agent('a1', { type: 'text', text: 'R', sources: [] })] }));
    expect(screen.getByText('Question comprise')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Votre dossier' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the typing indicator while waiting for the agent', () => {
    const { rerender } = view(build({ timeline: [user('u1', 'Q', 'accepted')] }));
    expect(screen.getByRole('status')).toHaveTextContent('L’assistant écrit…');
    rerender(
      <ConversationView
        conversation={build({ timeline: [user('u1', 'Q'), agent('a1', { type: 'text', text: 'R', sources: [] })] })}
        onRestart={() => {}}
      />,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('only the last agent message is interactive', () => {
    view(
      build({
        timeline: [
          user('u1', 'Q'),
          agent('a1', { type: 'buttons', items: [{ id: 'old', label: 'Ancien' }] }),
          agent('a2', { type: 'buttons', items: [{ id: 'new', label: 'Nouveau' }] }),
        ],
      }),
    );
    expect(screen.getByRole('button', { name: 'Ancien' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Nouveau' })).toBeEnabled();
  });

  it('sends the typed question and shows the disclaimer', async () => {
    const sendText = vi.fn();
    view(build({}, { sendText }));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Poser une autre question'), 'Bonjour');
    await user.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(sendText).toHaveBeenCalledWith('Bonjour');
    expect(
      screen.getByText('L’IA peut se tromper. Vérifiez les informations importantes sur le portail officiel.'),
    ).toBeInTheDocument();
  });

  it.each([
    [{ error: 'Boum' }, 'Réessayer'],
    [{ error: 'Session expirée', lost: true }, 'Nouvelle conversation'],
  ])('shows the error panel with the right restart label (%o)', async (extra, label) => {
    const onRestart = vi.fn();
    view(build({ status: 'error', ...extra }), onRestart);
    expect(screen.getByRole('alert')).toHaveTextContent(extra.error);
    await userEvent.setup().click(screen.getByRole('button', { name: label }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('shows a connecting state while starting', () => {
    view(build({ status: 'starting', conversationId: null }));
    expect(screen.getByRole('status')).toHaveTextContent('Connexion…');
    expect(screen.getByLabelText('Poser une autre question')).toBeDisabled();
  });

  it('restarts from the header', async () => {
    const onRestart = vi.fn();
    view(build({}), onRestart);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Nouvelle question' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});

describe('ConversationView scrolling', () => {
  const thread = () => screen.getByRole('log').closest('.overflow-y-auto') as HTMLDivElement;
  const layout = (el: HTMLElement, sizes: { scrollHeight: number; clientHeight: number }) => {
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: sizes.scrollHeight });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: sizes.clientHeight });
  };
  const timeline = [
    user('u1', 'Comment obtenir un casier judiciaire ?'),
    agent('a1', { type: 'text', text: 'Réponse', sources: [] }),
  ];

  it('keeps the composer outside the scrolling thread', () => {
    view(build({ timeline }));
    const composer = screen.getByRole('textbox', { name: 'Poser une autre question' });
    expect(thread().contains(composer)).toBe(false);
  });

  it('does not pull the reader down while they read older messages, and offers a way back', async () => {
    const { rerender } = view(build({ timeline }));
    const el = thread();
    layout(el, { scrollHeight: 2000, clientHeight: 400 });
    el.scrollTop = 0;
    fireEvent.scroll(el);

    const jump = screen.getByRole('button', { name: 'Aller au dernier message' });
    rerender(
      <ConversationView
        conversation={build({ timeline: [...timeline, agent('a2', { type: 'text', text: 'Suite', sources: [] })] })}
        onRestart={() => {}}
      />,
    );
    expect(el.scrollTop).toBe(0);

    await userEvent.click(jump);
    expect(el.scrollTop).toBe(2000);
  });

  it('jumps to the bottom when the user sends a message, even after scrolling up', () => {
    const { rerender } = view(build({ timeline }));
    const el = thread();
    layout(el, { scrollHeight: 2000, clientHeight: 400 });
    el.scrollTop = 0;
    fireEvent.scroll(el);

    rerender(
      <ConversationView
        conversation={build({ timeline: [...timeline, user('u2', 'Et ensuite ?', 'accepted')] })}
        onRestart={() => {}}
      />,
    );
    expect(el.scrollTop).toBe(2000);
  });
});
