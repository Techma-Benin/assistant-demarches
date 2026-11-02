import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantApp } from '@/components/app/AssistantApp';
import { noopConsent } from '@/lib/consent';
import type { useConversation } from '@/hooks/use-conversation';
import { initialState, type ConversationState } from '@/lib/conversation-state';

type Conversation = ReturnType<typeof useConversation>;

const hook = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/hooks/use-conversation', () => ({ useConversation: () => hook.current }));

function build(state: Partial<ConversationState>): Conversation {
  return {
    state: { ...initialState, status: 'ready', conversationId: 'cnv_1', ...state },
    connection: 'live',
    sendText: vi.fn(),
    sendButton: vi.fn(),
    sendForm: vi.fn(),
    sendFile: vi.fn(),
    sendFiles: vi.fn(),
    retry: vi.fn(),
    consent: noopConsent,
  };
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

  it('keeps the front door disabled while the conversation is starting', () => {
    hook.current = build({ status: 'starting', conversationId: null });
    render(<AssistantApp />);
    expect(screen.getByRole('button', { name: 'Renouveler mon passeport' })).toBeDisabled();
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
