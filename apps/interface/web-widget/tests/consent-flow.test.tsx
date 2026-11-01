import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConsentCard } from '@/components/chat/ConsentCard';
import { useConversation } from '@/hooks/use-conversation';
import { C1Error, type C1Client, type EventPage } from '@/lib/c1-client';
import { noopConsent, type ConsentControls, type ConsentFlow } from '@/lib/consent';

const CNV = 'cnv_' + '0'.repeat(25) + '1';
const pad = (n: number) => String(n).padStart(26, '0');
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const challenge = (over: Record<string, unknown> = {}) => ({
  id: 'chl_1',
  procedureId: 'proc-1',
  scopes: ['requests:write', 'documents:write', 'requests:submit'] as const,
  consentText: 'J’autorise <b>tout</b>',
  expiresAt: iso(5 * 60_000),
  ...over,
});
const card = (flow: ConsentFlow, over: Partial<ConsentControls> = {}) => {
  const consent: ConsentControls = {
    ...noopConsent,
    flow,
    accept: vi.fn(),
    refuse: vi.fn(),
    renew: vi.fn(),
    retry: vi.fn(),
    retract: vi.fn(),
    resume: vi.fn(),
    ...over,
  };
  render(<ConsentCard consent={consent} />);
  return consent;
};

describe('ConsentCard', () => {
  it('renders the server text as plain text with expiry and actions', () => {
    card({ phase: 'pending', challenge: challenge() as never });
    const region = screen.getByRole('region', { name: 'Autorisation demandée' });
    expect(region).toHaveTextContent('J’autorise <b>tout</b>');
    expect(region.querySelector('b')).toBeNull();
    expect(region).toHaveTextContent('Texte de l’autorisation');
    expect(region).toHaveTextContent(/Valable jusqu’au \p{L}+ \d{1,2} \p{L}+( \d{4})? à \d{2}:\d{2}/u);
    expect(region).toHaveTextContent('Vous pourrez retirer cette autorisation à tout moment.');
    expect(region).not.toHaveTextContent('STOP');
    expect(region).toHaveTextContent('créer et remplir votre demande');
    expect(region).toHaveTextContent('joindre vos pièces à la demande');
    expect(region).toHaveTextContent('transmettre la demande pour que vous la validiez sur le portail officiel');
    expect(region).toHaveTextContent('payer à votre place');
    expect(region).toHaveTextContent('valider la demande à votre place');
    const title = screen.getByRole('heading', { name: 'Autoriser l’assistant à agir pour vous ?' });
    expect(title).toHaveAttribute('tabindex', '-1');
    expect(title).toHaveFocus();
    expect(screen.getByRole('button', { name: 'J’autorise' })).not.toHaveFocus();
  });

  it('calls accept and refuse', async () => {
    const consent = card({ phase: 'pending', challenge: challenge() as never });
    await userEvent.click(screen.getByRole('button', { name: 'J’autorise' }));
    await userEvent.click(screen.getByRole('button', { name: 'Refuser' }));
    expect(consent.accept).toHaveBeenCalledOnce();
    expect(consent.refuse).toHaveBeenCalledOnce();
  });

  it('active state shows the mandate expiry, resume and retract', async () => {
    const consent = card({ phase: 'active', mandate: { id: 'mdt_1', expiresAt: iso(30 * 60_000) } });
    expect(screen.getByText(/Valable jusqu’au \p{L}+ \d{1,2} \p{L}+( \d{4})? à \d{2}:\d{2}/u)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reprendre ma demande' }));
    await userEvent.click(screen.getByRole('button', { name: 'Retirer l’autorisation' }));
    expect(consent.resume).toHaveBeenCalledOnce();
    expect(consent.retract).toHaveBeenCalledOnce();
  });

  it('refused: no accept offered, can change mind', async () => {
    const consent = card({ phase: 'refused' });
    expect(screen.getByText(/Autorisation refusée\. L’assistant ne fera aucune démarche/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'J’autorise' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Changer d’avis' }));
    expect(consent.renew).toHaveBeenCalledOnce();
  });

  it('expired challenge: buttons gone, ask again', async () => {
    const consent = card({ phase: 'pending', challenge: challenge({ expiresAt: iso(-1000) }) as never });
    expect(screen.getByText('Cette demande d’autorisation a expiré.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'J’autorise' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Demander à nouveau' }));
    expect(consent.renew).toHaveBeenCalledOnce();
  });

  it('expired mandate, invalid, revoked, no procedure, error', () => {
    const { unmount } = render(
      <ConsentCard consent={{ ...noopConsent, flow: { phase: 'active', mandate: { id: 'm', expiresAt: iso(-1) } } }} />,
    );
    expect(screen.getByText('Autorisation expirée')).toBeInTheDocument();
    unmount();
    const cases: [ConsentFlow, string][] = [
      [{ phase: 'invalid' }, 'Cette autorisation n’est plus valable.'],
      [{ phase: 'revoked' }, 'Autorisation retirée'],
      [{ phase: 'noProcedure' }, 'L’assistant doit d’abord identifier la démarche. Précisez votre demande.'],
      [{ phase: 'error', during: 'accept', message: 'Oups' }, 'Oups'],
    ];
    for (const [flow, text] of cases) {
      const view = render(<ConsentCard consent={{ ...noopConsent, flow }} />);
      expect(screen.getByText(text)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('does not steal focus from the composer', () => {
    const input = document.createElement('textarea');
    document.body.append(input);
    input.focus();
    card({ phase: 'pending', challenge: challenge() as never });
    expect(input).toHaveFocus();
    input.remove();
  });
});

// ---- hook: trigger -> challenge -> accept -> resume / revoke ----

const base = {
  specversion: '1.0' as const,
  source: 'urn:techma:backend',
  time: '2026-10-22T18:00:00Z',
  datacontenttype: 'application/json' as const,
  traceparent: '00-' + '1'.repeat(32) + '-' + '2'.repeat(16) + '-01',
};
const triggerPage = (withSource = true): EventPage =>
  ({
  items: [
    {
      ...base,
      id: `evt_${pad(1)}`,
      type: 'bj.techma.tool.called.v1',
      data: { kind: 'tool.called', toolName: 'request.create', conversationId: CNV, outcome: 'error', code: 'MANDATE_MISSING' },
    },
    {
      ...base,
      id: `evt_${pad(2)}`,
      type: 'bj.techma.message.sent.v1',
      data: {
        kind: 'message.sent',
        conversationId: CNV,
        message: {
          id: `msg_${pad(1)}`,
          conversationId: CNV,
          createdAt: base.time,
          blocks: [
            {
              type: 'text',
              text: 'Une autorisation explicite via l’interface est nécessaire pour poursuivre cette action.',
              sources: withSource ? [{ procedureId: 'proc-1', url: 'https://example.org', retrievedAt: base.time, version: 'v1' }] : [],
            },
          ],
        },
      },
    },
  ],
  nextCursor: `evt_${pad(2)}`,
}) as EventPage;

function fakeClient(page: EventPage, over: Partial<Record<string, unknown>> = {}) {
  let served = false;
  return {
    createConversation: vi.fn(async () => ({ id: CNV })),
    createSocketTicket: vi.fn(async () => {
      throw new Error('no socket');
    }),
    listEvents: vi.fn(async () => {
      if (served) return { items: [], nextCursor: null };
      served = true;
      return page;
    }),
    sendMessage: vi.fn(async (_id: string, input: { id: string }) => ({ id: input.id, status: 'accepted' })),
    createMandateChallenge: vi.fn(async () => ({ ...challenge(), userRef: 'usr_1', proofToken: 'SECRET.JWT' })),
    createMandate: vi.fn(async () => ({ id: 'mdt_1', status: 'active', expiresAt: iso(30 * 60_000) })),
    revokeMandate: vi.fn(async () => ({ id: 'mdt_1', status: 'revoked' })),
    ...over,
  };
}

describe('useConversation consent flow', () => {
  it('requests a challenge on the trigger, accepts with a stable key, resumes and revokes', async () => {
    const client = fakeClient(triggerPage());
    const { result } = renderHook(() => useConversation(client as unknown as C1Client));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    act(() => result.current.sendText('Je veux demander un acte'));

    await waitFor(() => expect(result.current.consent.flow.phase).toBe('pending'));
    const [cid, body, key] = client.createMandateChallenge.mock.calls[0] as unknown as [string, unknown, string];
    expect(cid).toBe(CNV);
    expect(body).toEqual({ procedureId: 'proc-1', scopes: ['requests:write', 'documents:write', 'requests:submit'] });
    expect(key).toBeTruthy();
    // proofToken / userRef are never kept in state.
    expect(JSON.stringify(result.current.consent.flow)).not.toContain('SECRET');
    expect(JSON.stringify(result.current.consent.flow)).not.toContain('usr_1');

    act(() => result.current.consent.accept());
    await waitFor(() => expect(result.current.consent.flow.phase).toBe('active'));
    expect(client.createMandate).toHaveBeenCalledWith(CNV, { challengeId: 'chl_1', accepted: true }, 'consent-chl_1');

    client.sendMessage.mockClear();
    act(() => result.current.consent.resume());
    await waitFor(() => expect(client.sendMessage).toHaveBeenCalledOnce());
    expect(client.sendMessage.mock.calls[0][1]).toMatchObject({ content: { type: 'text', text: 'Je veux demander un acte' } });

    act(() => result.current.consent.retract());
    await waitFor(() => expect(result.current.consent.flow.phase).toBe('revoked'));
    expect(client.revokeMandate).toHaveBeenCalledWith(CNV, 'mdt_1', expect.any(String));
  });

  it('says the procedure is unknown when there is none, and makes no API call', async () => {
    const client = fakeClient(triggerPage(false));
    const { result } = renderHook(() => useConversation(client as unknown as C1Client));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    await waitFor(() => expect(result.current.consent.flow.phase).toBe('noProcedure'));
    expect(client.createMandateChallenge).not.toHaveBeenCalled();
  });

  it('403 on accept means the challenge is no longer valid; refuse makes no call', async () => {
    const client = fakeClient(triggerPage(), {
      createMandate: vi.fn(async () => {
        throw new C1Error(403);
      }),
    });
    const { result } = renderHook(() => useConversation(client as unknown as C1Client));
    await waitFor(() => expect(result.current.consent.flow.phase).toBe('pending'));
    act(() => result.current.consent.accept());
    await waitFor(() => expect(result.current.consent.flow.phase).toBe('invalid'));
    act(() => result.current.consent.renew());
    await waitFor(() => expect(client.createMandateChallenge).toHaveBeenCalledTimes(2));
    const keys = (client.createMandateChallenge.mock.calls as unknown as string[][]).map((c) => c[2]);
    expect(keys[1]).not.toBe(keys[0]);
    await waitFor(() => expect(result.current.consent.flow.phase).toBe('pending'));
    act(() => result.current.consent.refuse());
    expect(result.current.consent.flow.phase).toBe('refused');
    expect(client.createMandate).toHaveBeenCalledTimes(1);
  });
});
