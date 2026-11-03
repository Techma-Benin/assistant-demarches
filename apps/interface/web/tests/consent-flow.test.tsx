import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConsentCard } from '@/components/chat/ConsentCard';
import { useConversation } from '@/hooks/use-conversation';
import { C1Error, type C1Client } from '@/lib/c1-client';
import { NEVER_DO, noopConsent, type Challenge, type ConsentControls, type ConsentState } from '@/lib/consent';
import { CONVERSATION_ID as CNV, agentEvent, consentBlock } from './fixtures-v2';

const challengeOf = (over: Partial<Challenge> = {}): Challenge => ({
  ...(consentBlock() as { type: 'consent'; challenge: Challenge }).challenge,
  ...over,
});

function card(state?: ConsentState, challenge: Challenge = challengeOf(), over: Partial<ConsentControls> = {}, interactive = true) {
  const consent: ConsentControls = {
    ...noopConsent,
    states: state ? { [challenge.id]: state } : {},
    accept: vi.fn(),
    refuse: vi.fn(),
    ...over,
  };
  render(<ConsentCard challenge={challenge} consent={consent} interactive={interactive} />);
  return { consent, challenge };
}

describe('ConsentCard', () => {
  it('shows the server consentText exactly as sent, as plain text, and nothing local about scopes', () => {
    const challenge = challengeOf({ consentText: 'J’autorise <b>tout</b>\nLigne deux' });
    card(undefined, challenge);
    const region = screen.getByRole('region', { name: 'Autorisation demandée' });
    expect(region).toHaveTextContent('J’autorise <b>tout</b> Ligne deux');
    expect(region.querySelector('b')).toBeNull();
    expect(region.textContent).toContain('J’autorise <b>tout</b>\nLigne deux');
    // No local scope labels, no local « ne fera jamais » list, no proof token.
    expect(region).not.toHaveTextContent('créer et remplir votre demande');
    expect(region).not.toHaveTextContent('Il ne fera jamais');
    for (const never of NEVER_DO) expect(region).not.toHaveTextContent(never);
    expect(region).not.toHaveTextContent('proof.jwt.token');
    const title = screen.getByRole('heading', { name: 'Autorisation' });
    expect(title).toHaveFocus();
    expect(screen.getByRole('button', { name: 'J’autorise' })).not.toHaveFocus();
  });

  it('calls accept and refuse with the challenge', async () => {
    const { consent, challenge } = card();
    await userEvent.click(screen.getByRole('button', { name: 'J’autorise' }));
    expect(consent.accept).toHaveBeenCalledWith(challenge);
    await userEvent.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(consent.refuse).toHaveBeenCalledWith(challenge);
  });

  it('disables both buttons while accepting', () => {
    card({ phase: 'accepting' });
    expect(screen.getByRole('button', { name: 'Enregistrement…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refuser' })).toBeDisabled();
  });

  it.each<[ConsentState, string]>([
    [{ phase: 'accepted' }, 'Autorisation accordée.'],
    [{ phase: 'refused' }, 'Autorisation refusée. L’assistant ne fera aucune démarche à votre place.'],
    [{ phase: 'invalid' }, 'Cette autorisation n’est plus valable.'],
  ])('final state %o: no button, the outcome is told', (state, text) => {
    card(state);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'J’autorise' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refuser' })).toBeNull();
  });

  it('an expired challenge offers nothing to click', () => {
    card(undefined, challengeOf({ expiresAt: '2020-01-01T00:00:00Z' }));
    expect(screen.getByText('Cette demande d’autorisation a expiré.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'J’autorise' })).toBeNull();
  });

  it('shows an error and keeps the buttons so the visitor can try again', () => {
    card({ phase: 'error', message: 'Oups' });
    expect(screen.getByText('Oups')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'J’autorise' })).toBeEnabled();
  });

  it('an older consent card is readable but cannot be answered', () => {
    card(undefined, challengeOf(), {}, false);
    expect(screen.getByRole('button', { name: 'J’autorise' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refuser' })).toBeDisabled();
  });

  it('does not steal focus from the composer', () => {
    const input = document.createElement('textarea');
    document.body.append(input);
    input.focus();
    card();
    expect(input).toHaveFocus();
    input.remove();
  });
});

// ---- hook: lazy start, accept with a stable Idempotency-Key, refuse stays local ----

function fakeClient(over: Partial<Record<string, unknown>> = {}) {
  let served = false;
  return {
    createConversation: vi.fn(async () => ({ id: CNV })),
    createSocketTicket: vi.fn(async () => {
      throw new Error('no socket');
    }),
    listEvents: vi.fn(async () => {
      if (served) return { items: [], nextCursor: null };
      served = true;
      return { items: [agentEvent(2, [consentBlock()])], nextCursor: null };
    }),
    sendMessage: vi.fn(async (_id: string, input: { id: string }) => ({ messageId: input.id, status: 'accepted' })),
    createMandate: vi.fn(async () => ({ id: 'mdt_1', status: 'active' })),
    ...over,
  };
}

describe('useConversation consent', () => {
  it('accepts the challenge of the block with a stable key, and never creates a challenge itself', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useConversation(client as unknown as C1Client));
    act(() => result.current.sendText('Je veux demander un casier'));
    await waitFor(() => expect(result.current.state.timeline.some((e) => e.kind === 'agent')).toBe(true));
    const challenge = challengeOf();
    expect(result.current.consent.states[challenge.id]).toBeUndefined();

    act(() => result.current.consent.accept(challenge));
    await waitFor(() => expect(result.current.consent.states[challenge.id]).toEqual({ phase: 'accepted' }));
    expect(client.createMandate).toHaveBeenCalledTimes(1);
    expect(client.createMandate).toHaveBeenCalledWith(CNV, { challengeId: challenge.id, accepted: true }, `consent-${challenge.id}`);
    // The Backend replays the blocked action: the client sends no « continue » message.
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('refusing makes no API call (the contract only accepts accepted: true)', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useConversation(client as unknown as C1Client));
    act(() => result.current.sendText('Bonjour'));
    await waitFor(() => expect(result.current.state.conversationId).toBe(CNV));
    act(() => result.current.consent.refuse(challengeOf()));
    expect(result.current.consent.states[challengeOf().id]).toEqual({ phase: 'refused' });
    expect(client.createMandate).not.toHaveBeenCalled();
  });

  it.each([403, 404, 409])('%i on accept means the challenge is no longer valid', async (status) => {
    const client = fakeClient({ createMandate: vi.fn(async () => Promise.reject(new C1Error(status))) });
    const { result } = renderHook(() => useConversation(client as unknown as C1Client));
    act(() => result.current.sendText('Bonjour'));
    await waitFor(() => expect(result.current.state.conversationId).toBe(CNV));
    act(() => result.current.consent.accept(challengeOf()));
    await waitFor(() => expect(result.current.consent.states[challengeOf().id]).toEqual({ phase: 'invalid' }));
  });

  it('a network error can be retried with the same Idempotency-Key', async () => {
    const createMandate = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({ id: 'mdt_1' });
    const client = fakeClient({ createMandate });
    const { result } = renderHook(() => useConversation(client as unknown as C1Client));
    act(() => result.current.sendText('Bonjour'));
    await waitFor(() => expect(result.current.state.conversationId).toBe(CNV));
    act(() => result.current.consent.accept(challengeOf()));
    await waitFor(() => expect(result.current.consent.states[challengeOf().id]).toMatchObject({ phase: 'error' }));
    act(() => result.current.consent.accept(challengeOf()));
    await waitFor(() => expect(result.current.consent.states[challengeOf().id]).toEqual({ phase: 'accepted' }));
    expect(createMandate.mock.calls.map((call) => (call as unknown[])[2])).toEqual([`consent-${challengeOf().id}`, `consent-${challengeOf().id}`]);
  });
});
