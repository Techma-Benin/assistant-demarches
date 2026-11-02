import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantApp } from '@/components/app/AssistantApp';
import { loadConversation, saveConversation, type ConversationSnapshot } from '@/lib/conversation-persistence';
import type { TimelineEntry } from '@/lib/conversation-state';

const CNV = 'cnv_' + '0'.repeat(25) + '1';
const fake = vi.hoisted(() => ({
  createConversation: vi.fn(),
  createSocketTicket: vi.fn(),
  listEvents: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock('@/lib/c1-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/c1-client')>()),
  C1Client: vi.fn(function () {
    return fake;
  }),
}));

const user = (): TimelineEntry => ({
  kind: 'user',
  id: 'msg_1',
  content: { type: 'text', text: 'Comment obtenir un acte ?' },
  display: 'Comment obtenir un acte ?',
  sentAt: new Date().toISOString(),
  delivery: 'received',
});
const saved = (): ConversationSnapshot => ({
  conversationId: CNV,
  cursor: 'evt_9',
  seenEventIds: ['evt_9'],
  timeline: [user()],
  requestProcedureId: null,
  mandate: null,
});

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  fake.createConversation.mockReset().mockResolvedValue({ id: 'cnv_new' });
  fake.createSocketTicket.mockReset().mockRejectedValue(new Error('no socket'));
  fake.listEvents.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  fake.sendMessage.mockReset().mockResolvedValue({});
});

describe('home and conversation views', () => {
  it('shows home with a resume banner, then the conversation on « Reprendre »', async () => {
    saveConversation(saved());
    render(<AssistantApp initialView="home" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vos démarches');
    expect(screen.getByText(/^Conversation en cours/)).toBeInTheDocument();
    expect(screen.getByText(/^Conversation en cours : « Comment obtenir un acte/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reprendre' }));
    expect(screen.getByRole('log')).toHaveTextContent('Comment obtenir un acte ?');
    expect(window.location.pathname).toBe('/conversation');
  });

  it('goes home from the brand mark and keeps the conversation saved', async () => {
    saveConversation(saved());
    window.history.replaceState(null, '', '/conversation');
    render(<AssistantApp initialView="conversation" />);
    await userEvent.click(screen.getByRole('link', { name: 'Accueil' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vos démarches');
    expect(loadConversation()).not.toBeNull();
    expect(window.location.pathname).toBe('/');
  });

  it('follows Back and Forward', async () => {
    saveConversation(saved());
    render(<AssistantApp initialView="home" />);
    await userEvent.click(screen.getByRole('button', { name: 'Reprendre' }));
    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vos démarches');
    act(() => {
      window.history.replaceState(null, '', '/conversation');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByRole('log')).toBeInTheDocument();
  });

  it('starts a new conversation when asking from home with a saved one', async () => {
    saveConversation(saved());
    render(<AssistantApp initialView="home" />);
    await userEvent.click(screen.getByRole('button', { name: 'Renouveler mon passeport' }));
    await waitFor(() => expect(fake.createConversation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fake.sendMessage).toHaveBeenCalledTimes(1));
    expect(fake.sendMessage.mock.calls[0]).toMatchObject(['cnv_new', { content: { type: 'text', text: 'Renouveler mon passeport' } }]);
    expect(screen.getByRole('log')).toHaveTextContent('Renouveler mon passeport');
    expect(screen.getByRole('log')).not.toHaveTextContent('Comment obtenir un acte');
    expect(window.location.pathname).toBe('/conversation');
  });

  it('falls back to home when /conversation has nothing saved', async () => {
    window.history.replaceState(null, '', '/conversation');
    render(<AssistantApp initialView="conversation" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vos démarches');
    expect(window.location.pathname).toBe('/');
  });

  it('without a saved conversation, the first question opens the conversation', async () => {
    render(<AssistantApp initialView="home" />);
    expect(screen.queryByText(/^Conversation en cours/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Renouveler mon passeport' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Renouveler mon passeport' }));
    await waitFor(() => expect(fake.sendMessage).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('log')).toHaveTextContent('Renouveler mon passeport');
    expect(window.location.pathname).toBe('/conversation');
  });
});
