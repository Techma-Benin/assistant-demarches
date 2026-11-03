import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from '@techma/contracts-ts';
import { MessageActions, messagePlainText } from '@/components/chat/MessageActions';

type AgentMessage = components['schemas']['AgentMessage'];

const message: AgentMessage = {
  id: 'm1',
  conversationId: 'c1',
  createdAt: '2026-11-01T10:00:00Z',
  blocks: [
    {
      type: 'text',
      text: '## Pièces\nVoici **les pièces** :\n1. Carte\n2. Photo',
      sources: [{ procedureId: 'F1234', url: 'https://service-public.fr/F1234', retrievedAt: '2026-11-01T10:00:00Z', version: '1' }],
    },
    { type: 'fileRequest', documentType: 'id', label: 'Carte d’identité', acceptedMimeTypes: ['image/png'] },
  ],
} as AgentMessage;

describe('messagePlainText', () => {
  it('strips markdown, keeps numbering, lists labels and sources', () => {
    expect(messagePlainText(message)).toBe(
      'Pièces\nVoici les pièces :\n1. Carte\n2. Photo\n\nCarte d’identité\n\nSources :\n1. F1234 https://service-public.fr/F1234',
    );
  });
});

describe('MessageActions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('copies, announces, then resets', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<MessageActions message={message} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copier la réponse' }));
    });
    expect(writeText).toHaveBeenCalledWith(messagePlainText(message));
    expect(screen.getByRole('status')).toHaveTextContent('Réponse copiée');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('falls back to execCommand without clipboard API', async () => {
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    render(<MessageActions message={message} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copier la réponse' }));
    });
    expect(exec).toHaveBeenCalledWith('copy');
    expect(screen.getByRole('status')).toHaveTextContent('Réponse copiée');
  });

  it('reports a failure when every path fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(false), configurable: true });
    render(<MessageActions message={message} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copier la réponse' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Copie impossible');
  });

  it('shows a tooltip that reads « Copié » after a copy', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    const { container } = render(<MessageActions message={message} />);
    const tip = container.querySelector('span[aria-hidden="true"].pointer-events-none');
    expect(tip).toHaveTextContent('Copier la réponse');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copier la réponse' }));
    });
    expect(tip).toHaveTextContent('Copié');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(tip).toHaveTextContent('Copier la réponse');
  });
});
