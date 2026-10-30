import { noopConsent } from '@/lib/consent';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatWidget } from '@/components/chat/ChatWidget';
import type { StreamStatus } from '@/lib/conversation-stream';
import { initialState } from '@/lib/conversation-state';

let connection: StreamStatus = 'live';
vi.mock('@/hooks/use-conversation', () => ({
  useConversation: () => ({
    state: { ...initialState, status: 'ready', conversationId: 'cnv_1' },
    connection,
    sendText: () => {},
    sendButton: () => {},
    sendForm: () => {},
    sendFile: () => {},
    retry: () => {},
    consent: noopConsent,
  }),
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('connection notice', () => {
  it('shows nothing when live', () => {
    connection = 'live';
    render(<ChatWidget />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the warning only after 3 s of polling', () => {
    connection = 'polling';
    render(<ChatWidget />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.getByRole('status')).toHaveTextContent('Connexion instable, reconnexion en cours…');
  });

  it('shows the offline notice immediately', () => {
    connection = 'offline';
    render(<ChatWidget />);
    expect(screen.getByRole('status')).toHaveTextContent('Vous êtes hors ligne.');
  });
});
