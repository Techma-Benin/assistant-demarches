import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantApp } from '@/components/app/AssistantApp';
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
    retry: vi.fn(),
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

  it('keeps the front door disabled while the conversation is starting', () => {
    hook.current = build({ status: 'starting', conversationId: null });
    render(<AssistantApp />);
    expect(screen.getByRole('button', { name: 'Renouveler mon passeport' })).toBeDisabled();
  });

  it('switches to the conversation view once a question is in the timeline', () => {
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
    render(<AssistantApp />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Renouveler mon passeport');
    expect(screen.getByRole('log')).toBeInTheDocument();
  });

  it('shows the retry panel when the conversation fails to start', () => {
    hook.current = build({ status: 'error', error: 'Impossible de démarrer la conversation. Veuillez réessayer.' });
    render(<AssistantApp />);
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
