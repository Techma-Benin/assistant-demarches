import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Schemas } from '@techma/contracts-ts';
import { describe, expect, it, vi } from 'vitest';
import { ConversationView } from '@/components/chat/ConversationView';
import { turnDelivery, userTurns, type UserEntry as UserEntryT } from '@/components/chat/UserEntryParts';
import { initialState, type ConversationState, type TimelineEntry } from '@/lib/conversation-state';

import { fakeConversation, type Conversation } from './conversation-helper';
import { caseCardBlock, consentBlock, exampleRequest, requestCardBlock } from './fixtures-v2';

type Block = Schemas['Block'];

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
const source = (procedureId: string, url: string) => ({ procedureId, url, retrievedAt: at });

function build(state: Partial<ConversationState>, overrides: Partial<Conversation> = {}): Conversation {
  return fakeConversation({ state: { ...initialState, status: 'ready', conversationId: 'cnv_1', ...state }, ...overrides });
}
const view = (conversation: Conversation, onRestart = () => {}) =>
  render(<ConversationView conversation={conversation} onRestart={onRestart} />);

describe('ConversationView', () => {
  it('shows every user message as a bubble, the first question in the header, and one sr-only h1', () => {
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
    expect(h1[0]).toHaveTextContent('Conversation avec l’Assistant Démarches');
    expect(h1[0]).toHaveClass('sr-only');
    expect(screen.getAllByText('Comment obtenir un casier judiciaire ?')).toHaveLength(2);
    const bubble = within(screen.getByRole('log')).getByText('Comment obtenir un casier judiciaire ?');
    expect(bubble).toHaveClass('bg-sunken');
    expect(screen.getByText('Préparer ma demande')).toHaveClass('bg-sunken');
  });

  it('groups consecutive entries, with the sender and time on agent groups and the time on the last user bubble', () => {
    view(
      build({
        timeline: [
          user('u1', 'Q1'),
          user('u2', 'Q2'),
          agent('a1', { type: 'text', text: 'R1', sources: [] }),
          agent('a2', { type: 'text', text: 'R2', sources: [] }),
        ],
      }),
    );
    const log = screen.getByRole('log');
    expect(within(log).getAllByText('Assistant Démarches')).toHaveLength(1);
    const times = log.querySelectorAll('time');
    expect(times).toHaveLength(2);
    times.forEach((t) => {
      expect(t).toHaveAttribute('dateTime', at);
      expect(t.textContent).toMatch(/^\d{2}:\d{2}$/);
    });
  });

  it('does not animate the history present at mount, but reveals a live answer', () => {
    const history = [user('u1', 'Q'), agent('a1', { type: 'text', text: 'Un deux', sources: [] })];
    const { container, rerender } = view(build({ timeline: history }));
    expect(container.querySelector('.chat-word, .chat-reveal, .ui-enter')).toBeNull();
    rerender(
      <ConversationView
        conversation={build({ timeline: [...history, agent('a2', { type: 'text', text: 'Trois quatre', sources: [] })] })}
        onRestart={() => {}}
      />,
    );
    expect(container.querySelectorAll('.chat-word')).toHaveLength(2);
    expect(screen.getByRole('log')).toHaveTextContent('Trois quatre');
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
    expect(within(panel).getByText('service-public.example')).toBeInTheDocument();
    expect(within(panel).getByText('Consultée le 22/10/2026')).toBeInTheDocument();
    expect(within(panel).queryByText(/v3/)).toBeNull();
    expect(within(panel).queryByText('ancienne-fiche')).toBeNull();
  });

  it('hides the sources panel when the last text block has none', () => {
    view(build({ timeline: [user('u1', 'Q'), agent('a1', { type: 'text', text: 'R', sources: [] })] }));
    expect(screen.queryByRole('heading', { name: 'Sources' })).toBeNull();
  });

  it('shows « Vos informations » from the latest requestCard, and a header pill opening it on small screens', async () => {
    const older = { ...exampleRequest, missing: ['Extrait d’acte de naissance'], documents: [{ ...exampleRequest.documents[0], fileId: null }] };
    view(
      build({
        timeline: [
          user('u1', 'Q'),
          agent('a1', { type: 'text', text: 'R', sources: [] }, requestCardBlock(older)),
          user('u2', 'Voici'),
          agent('a2', requestCardBlock()),
        ],
      }),
    );
    const panel = screen.getByRole('heading', { name: 'Vos informations', level: 2 }).closest('section')!;
    // Latest card wins: nothing is missing any more.
    expect(within(panel).queryByText('Il manque encore')).toBeNull();
    expect(within(panel).getByText('Adresse du domicile')).toBeInTheDocument();
    expect(within(panel).getByText('Cotonou, Akpakpa')).toBeInTheDocument();
    expect(within(panel).getAllByText('Votre réponse').length).toBeGreaterThan(0);
    expect(within(panel).getByText(/Extrait d'acte de naissance sécurisé ou légalisé/)).toBeInTheDocument();
    const pill = screen.getByRole('button', { name: 'Vos informations' });
    await userEvent.setup().click(pill);
    expect(screen.getAllByText('Adresse du domicile')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
  });

  it('lists what is missing in the panel', () => {
    view(build({ timeline: [user('u1', 'Q'), agent('a1', requestCardBlock({ ...exampleRequest, status: 'draft', missing: ['Profession'] }))] }));
    const panel = screen.getByRole('heading', { name: 'Vos informations', level: 2 }).closest('section')!;
    expect(within(panel).getByText('Il manque encore')).toBeInTheDocument();
    expect(within(within(panel).getByText('Il manque encore').parentElement!).getByText('Profession')).toBeInTheDocument();
  });

  it('offers a Sources (n) header button when there is no request, opening the sources dialog', async () => {
    view(build({ timeline: [user('u1', 'Q'), agent('a1', { type: 'text', text: 'R', sources: [source('casier', 'https://a.example/c')] })] }));
    expect(screen.queryByRole('button', { name: 'Vos informations' })).toBeNull();
    expect(screen.getAllByText('casier')).toHaveLength(2);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sources (1)' }));
    expect(screen.getAllByText('casier')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
  });

  it('opens the panels in a right drawer from md up', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      view(build({ timeline: [user('u1', 'Q'), agent('a1', { type: 'text', text: 'R', sources: [source('casier', 'https://a.example/c')] })] }));
      await userEvent.setup().click(screen.getByRole('button', { name: 'Sources (1)' }));
      const drawer = document.querySelector('dialog.chat-drawer') as HTMLDialogElement;
      expect(drawer).not.toBeNull();
      expect(within(drawer).getByText('casier')).toBeInTheDocument();
      expect(document.querySelector('dialog.chat-sheet')).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });

  it('hides the dossier panel and pill on a simple Q&A', () => {
    view(build({ timeline: [user('u1', 'Q'), agent('a1', { type: 'text', text: 'R', sources: [] })] }));
    expect(screen.queryByRole('button', { name: 'Vos informations' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Vos informations', level: 2 })).toBeNull();
  });

  it('shows a neutral activity while waiting, announced once outside the log', () => {
    const { rerender } = view(build({ timeline: [user('u1', 'Q', 'accepted')] }));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('L’assistant prépare sa réponse');
    expect(screen.getByRole('log').contains(status)).toBe(false);
    expect(screen.getByRole('log').querySelector('[role="status"]')).toBeNull();
    rerender(
      <ConversationView
        conversation={build({ timeline: [user('u1', 'Q'), agent('a1', { type: 'text', text: 'R', sources: [] })] })}
        onRestart={() => {}}
      />,
    );
    // Only the copy buttons' empty live regions remain.
    expect(screen.queryAllByRole('status').filter((s) => s.textContent !== '')).toHaveLength(0);
  });

  it('keeps waiting once the visitor accepted the consent the assistant asked for', () => {
    const block = consentBlock();
    const challengeId = (block as Extract<Block, { type: 'consent' }>).challenge.id;
    view(
      build(
        { timeline: [user('u1', 'Q'), agent('a1', block)] },
        { consent: { states: { [challengeId]: { phase: 'accepted' } }, accept: vi.fn(), refuse: vi.fn() } },
      ),
    );
    expect(screen.getAllByRole('status').filter((node) => node.textContent !== '')).toHaveLength(1);
    expect(screen.getByText('L’assistant prépare sa réponse', { selector: '[role="status"]' })).toBeInTheDocument();
  });

  it('adds a reassurance line after 8 seconds of waiting', () => {
    vi.useFakeTimers();
    try {
      view(build({ timeline: [user('u1', 'Q', 'accepted')] }));
      expect(screen.queryByText(/prend un peu plus de temps/)).toBeNull();
      act(() => {
        vi.advanceTimersByTime(8000);
      });
      expect(screen.getByText('Cela prend un peu plus de temps que d’habitude.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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

  it('sends the typed question and shows the disclaimer at the top of the thread', async () => {
    const sendText = vi.fn();
    view(build({}, { sendText }));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Votre message'), 'Bonjour');
    await user.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect(sendText).toHaveBeenCalledWith('Bonjour');
    const disclaimer = screen.getByText('L’IA peut se tromper. Vérifiez les informations importantes sur le portail officiel.');
    expect(disclaimer.closest('.overflow-y-auto')).not.toBeNull();
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

  it('shows a connecting state while the first message creates the conversation, with the composer still usable', () => {
    view(build({ status: 'starting', conversationId: null }));
    expect(screen.getByRole('status')).toHaveTextContent('Connexion…');
    expect(screen.getByLabelText('Votre message')).toBeEnabled();
  });

  it('greets a visitor with no conversation yet and lets them write', () => {
    view(build({ status: 'idle', conversationId: null }));
    expect(screen.getByRole('heading', { name: 'Bonjour !' })).toBeInTheDocument();
    expect(screen.getByLabelText('Votre message')).toBeEnabled();
  });

  it('restarts from the header at once when nothing would be lost', async () => {
    const onRestart = vi.fn();
    view(build({ timeline: [user('u1', 'Q'), agent('a1', { type: 'text', text: 'R', sources: [] })] }), onRestart);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Nouvelle question' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('opens a full-size preview from a sent image card', async () => {
    const proto = HTMLDialogElement.prototype;
    const original = proto.showModal;
    proto.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    try {
      const image: TimelineEntry = {
        ...(user('u2', 'photo.png') as Extract<TimelineEntry, { kind: 'user' }>),
        content: null,
        batchId: 'batch_img',
        attachment: { name: 'photo.png', sizeBytes: 10, mimeType: 'image/png', previewUrl: 'blob:sent' },
      };
      view(build({ timeline: [image] }));
      const u = userEvent.setup();
      await u.click(screen.getByRole('button', { name: 'Voir photo.png' }));
      const dialog = screen.getByRole('dialog', { name: 'Aperçu de photo.png' });
      expect(within(dialog).getByRole('img', { name: 'photo.png' })).toHaveAttribute('src', 'blob:sent');
      await u.click(within(dialog).getByRole('button', { name: 'Fermer l’aperçu' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      proto.showModal = original;
    }
  });

  it('asks for confirmation before restarting a conversation holding a dossier', async () => {
    const onRestart = vi.fn();
    const attached: TimelineEntry = {
      ...(user('u2', 'cni.pdf') as Extract<TimelineEntry, { kind: 'user' }>),
      attachment: { name: 'cni.pdf', sizeBytes: 10, mimeType: 'application/pdf' },
    };
    view(build({ timeline: [user('u1', 'Q'), attached] }), onRestart);
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Nouvelle question' }));
    expect(onRestart).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Recommencer une conversation ?' });
    expect(dialog).toHaveTextContent('Vous perdrez l’affichage de cette conversation.');
    await u.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog', { name: 'Recommencer une conversation ?' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Nouvelle question' }));
    await u.click(screen.getByRole('button', { name: 'Recommencer' }));
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
    const composer = screen.getByRole('textbox', { name: 'Votre message' });
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

  describe('batched user turn', () => {
    const file = (id: string, name: string, delivery: 'received' | 'uploadFailed' | 'uploading' = 'received'): TimelineEntry => ({
      kind: 'user',
      id,
      content: null,
      display: name,
      sentAt: at,
      delivery,
      batchId: 'batch_1',
      attachment: { name, sizeBytes: 1200, mimeType: 'application/pdf' },
      ...(delivery === 'uploadFailed' ? { error: 'Échec de l’envoi de la pièce.', retryable: true } : {}),
    });
    const note = (delivery: 'received' | 'sending' = 'received'): TimelineEntry => ({
      ...(user('n1', 'Voici mes pièces', delivery as 'received') as Extract<TimelineEntry, { kind: 'user' }>),
      batchId: 'batch_1',
    });

    it('renders files and note as one turn with one status line', () => {
      view(build({ timeline: [file('f1', 'recto.pdf'), file('f2', 'verso.pdf'), note()] }));
      const log = screen.getByRole('log');
      const turns = log.querySelectorAll('[data-turn]');
      expect(turns).toHaveLength(1);
      const group = within(turns[0] as HTMLElement).getByRole('group', { name: '2 pièces jointes' });
      expect(group.querySelectorAll('[data-entry-id]')).toHaveLength(2);
      const bubble = within(turns[0] as HTMLElement).getByText('Voici mes pièces');
      expect(group.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(log).getAllByText('Reçu')).toHaveLength(1);
      expect(log.querySelectorAll('time')).toHaveLength(1);
    });

    it('shows a failed file error and retry under its card while the turn still shows', async () => {
      const retry = vi.fn();
      const user_ = userEvent.setup();
      view(build({ timeline: [file('f1', 'recto.pdf'), file('f2', 'verso.pdf', 'uploadFailed'), note('sending')] }, { retry }));
      const card = screen.getByText('verso.pdf').closest('[data-entry-id]') as HTMLElement;
      expect(within(card).getByText('Échec de l’envoi de la pièce.')).toBeInTheDocument();
      await user_.click(within(card).getByRole('button', { name: 'Réessayer' }));
      expect(retry).toHaveBeenCalledWith('f2');
      const log = screen.getByRole('log');
      expect(within(log).getByText('Voici mes pièces')).toBeInTheDocument();
      expect(within(log).getByText('Envoi…')).toBeInTheDocument();
    });
  });
});

describe('userTurns and turnDelivery', () => {
  const e = (id: string, batchId?: string, delivery: 'received' | 'accepted' | 'sending' | 'uploading' | 'failed' | 'uploadFailed' = 'received') =>
    ({ ...(user(id, id) as Extract<TimelineEntry, { kind: 'user' }>), batchId, delivery });

  it('groups consecutive entries sharing a batchId and leaves others alone', () => {
    const items = [e('a'), e('b', 'x'), e('c', 'x'), e('d'), e('f', 'y'), e('g', 'x')].map((entry) => ({ entry }));
    expect(userTurns(items).map((t) => t.map((i) => i.entry.kind === 'user' && i.entry.id))).toEqual([
      ['a'],
      ['b', 'c'],
      ['d'],
      ['f'],
      ['g'],
    ]);
  });

  it('aggregates delivery, ignoring failed entries', () => {
    expect(turnDelivery([e('a', 'x', 'uploading'), e('b', 'x', 'received')])).toBe('sending');
    expect(turnDelivery([e('a', 'x', 'accepted'), e('b', 'x', 'received')])).toBe('accepted');
    expect(turnDelivery([e('a', 'x', 'received'), e('b', 'x', 'received')])).toBe('received');
    expect(turnDelivery([e('a', 'x', 'uploadFailed'), e('b', 'x', 'received')])).toBe('received');
    expect(turnDelivery([e('a', 'x', 'failed'), e('b', 'x', 'uploadFailed')])).toBeNull();
  });

  it('renders an audio entry as a voice bubble with a single status line', () => {
    const voice: TimelineEntry = {
      kind: 'user',
      id: 'v1',
      content: { type: 'audio', fileId: 'fil_1' as never },
      display: 'Message vocal.m4a',
      sentAt: at,
      delivery: 'received',
      batchId: 'batch_v',
      attachment: {
        name: 'Message vocal.m4a',
        sizeBytes: 10,
        mimeType: 'audio/mp4',
        previewUrl: 'blob:voice',
        durationMs: 7000,
        waveform: Array(32).fill(0.5),
      },
    };
    view(build({ timeline: [voice] }));
    expect(screen.getByRole('button', { name: 'Écouter le message vocal' })).toBeEnabled();
    expect(screen.getByText('0:07')).toBeInTheDocument();
    expect(screen.getAllByText('Reçu')).toHaveLength(1);
  });

  describe('voice transcript', () => {
    const voiceWith = (transcript?: UserEntryT['transcript']): TimelineEntry => ({
      kind: 'user',
      id: 'v1',
      content: { type: 'audio', fileId: 'fil_1' },
      display: 'Message vocal.m4a',
      sentAt: at,
      delivery: 'received',
      attachment: { name: 'Message vocal.m4a', sizeBytes: 10, mimeType: 'audio/mp4', previewUrl: 'blob:voice', durationMs: 7000 },
      ...(transcript ? { transcript } : {}),
    });

    it('toggles a done transcript', async () => {
      view(build({ timeline: [voiceWith({ status: 'done', text: 'Bonjour le monde' })] }));
      const button = screen.getByRole('button', { name: 'Afficher la transcription' });
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('Bonjour le monde')).not.toBeInTheDocument();
      await userEvent.click(button);
      expect(screen.getByText('Bonjour le monde')).toBeInTheDocument();
      const hide = screen.getByRole('button', { name: 'Masquer la transcription' });
      expect(hide).toHaveAttribute('aria-expanded', 'true');
    });
    it('shows a failed transcript as plain text', () => {
      view(build({ timeline: [voiceWith({ status: 'failed' })] }));
      expect(screen.getByText('Transcription indisponible')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /transcription/ })).not.toBeInTheDocument();
    });
    it('shows nothing without transcript', () => {
      view(build({ timeline: [voiceWith()] }));
      expect(screen.queryByText('Transcription indisponible')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /transcription/ })).not.toBeInTheDocument();
    });
  });

  describe('prepare request action', () => {
    const cited = (...ids: string[]): Block => ({
      type: 'text',
      text: 'Présentation',
      sources: ids.map((id) => source(id, `https://service-public.fr/${id}`)),
    });
    it('shows the chip and sends the fixed message on click', async () => {
      const conversation = build({ timeline: [user('u1', 'Q'), agent('a1', cited('F1'))] });
      view(conversation);
      await userEvent.click(screen.getByRole('button', { name: 'Préparer ma demande' }));
      expect(conversation.sendText).toHaveBeenCalledWith('Je veux préparer ma demande pour cette démarche (F1).');
    });

    it.each([
      ['a case card exists', [user('u1', 'Q'), agent('a0', caseCardBlock()), user('u2', 'Q2'), agent('a1', cited('F1'))]],
      ['a draft exists', [user('u1', 'Q'), agent('a0', requestCardBlock()), user('u2', 'Q2'), agent('a1', cited('F1'))]],
      ['the last entry is a user message', [agent('a1', cited('F1')), user('u2', 'Merci')]],
      ['sources span two procedures', [user('u1', 'Q'), agent('a1', cited('F1', 'F2'))]],
    ])('is hidden when %s', (_name, timeline) => {
      view(build({ timeline }));
      expect(screen.queryByRole('button', { name: 'Préparer ma demande' })).not.toBeInTheDocument();
    });
  });
});
