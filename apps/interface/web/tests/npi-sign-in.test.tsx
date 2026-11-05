import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NpiSignIn } from '@/components/app/NpiSignIn';
import { navigate } from '@/lib/navigate';
import { CONVERSATION_ID } from './fixtures-v2';

vi.mock('@/lib/navigate', () => ({ navigate: vi.fn() }));

type Reply = { status: number; body?: unknown };
let replies: Reply[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(navigate).mockReset();
  replies = [];
  localStorage.clear();
  sessionStorage.clear();
  fetchMock = vi.fn(async () => {
    const reply = replies.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const sentBodies = () => fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse((init as RequestInit).body as string)]);

async function toCodeStep() {
  replies.push({ status: 200, body: { expiresAt: 'x', simulated: true } });
  await userEvent.type(screen.getByLabelText('Votre NPI'), '123456');
  await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  return screen.findByLabelText('Code reçu par SMS');
}

describe('NpiSignIn', () => {
  it('goes through both steps, focusing each field, and navigates to returnTo', async () => {
    render(<NpiSignIn returnTo="/demarches" conversationId={CONVERSATION_ID} />);
    const npi = screen.getByLabelText('Votre NPI');
    expect(npi).toHaveFocus();
    expect(npi).toHaveAttribute('inputmode', 'numeric');
    expect(npi).toHaveAttribute('autocomplete', 'off');
    const code = await toCodeStep();
    expect(code).toHaveFocus();
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.queryByLabelText('Votre NPI')).toBeNull();

    replies.push({ status: 200, body: { attachFailed: false } });
    await userEvent.type(code, '0000');
    await userEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/demarches'));
    expect(sentBodies()).toEqual([
      ['/auth/npi', { npi: '123456' }],
      ['/auth/npi/verify', { code: '0000', conversationId: CONVERSATION_ID }],
    ]);
  });

  it('omits conversationId when there is none, and flags a failed attach in the return URL', async () => {
    render(<NpiSignIn returnTo="/conversation?x=1" />);
    const code = await toCodeStep();
    replies.push({ status: 200, body: { attachFailed: true } });
    await userEvent.type(code, '1');
    await userEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/conversation?x=1&attach=failed'));
    expect(sentBodies()[1][1]).toEqual({ code: '1' });
  });

  it('accepts digits only, with a clear message and no call', async () => {
    render(<NpiSignIn returnTo="/" />);
    await userEvent.type(screen.getByLabelText('Votre NPI'), '12a4');
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saisissez uniquement des chiffres.');
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('Votre NPI'));
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce champ est obligatoire.');
  });

  it('clears the NPI once step 1 succeeds, and "Changer de NPI" returns to an empty step 1', async () => {
    render(<NpiSignIn returnTo="/" />);
    await toCodeStep();
    expect(screen.getByLabelText('Code reçu par SMS')).toHaveValue('');
    expect(document.body.innerHTML).not.toContain('123456');
    await userEvent.click(screen.getByRole('button', { name: 'Changer de NPI' }));
    const npi = screen.getByLabelText('Votre NPI');
    expect(npi).toHaveValue('');
    expect(npi).toHaveFocus();
  });

  it.each([
    [400, /ne sont pas acceptés/],
    [429, /Trop de tentatives/],
    [503, /indisponible/],
  ])('shows a readable error for %i without technical detail', async (status, message) => {
    render(<NpiSignIn returnTo="/" />);
    replies.push({ status, body: { code: 'INTERNAL', detail: 'stack trace' } });
    await userEvent.type(screen.getByLabelText('Votre NPI'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).not.toHaveTextContent(/stack|INTERNAL|\b\d{3}\b/);
    expect(screen.getByLabelText('Votre NPI')).toHaveFocus();
  });

  it('goes back to step 1 on a 401 at step 2', async () => {
    render(<NpiSignIn returnTo="/" />);
    const code = await toCodeStep();
    replies.push({ status: 401 });
    await userEvent.type(code, '1');
    await userEvent.click(screen.getByRole('button', { name: 'Valider' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/a expiré/);
    expect(screen.getByLabelText('Votre NPI')).toHaveFocus();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows an unavailable message when the network fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    render(<NpiSignIn returnTo="/" />);
    await userEvent.type(screen.getByLabelText('Votre NPI'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/indisponible/);
  });

  it('disables the buttons while the call is pending', async () => {
    let release!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (release = resolve)));
    render(<NpiSignIn returnTo="/" />);
    await userEvent.type(screen.getByLabelText('Votre NPI'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled();
    release(new Response('{}', { status: 200 }));
    expect(await screen.findByLabelText('Code reçu par SMS')).toBeInTheDocument();
  });

  it('always shows the Simulation and out-of-conversation notes, and stores nothing', async () => {
    render(<NpiSignIn returnTo="/" />);
    const notes = ['Simulation : aucun SMS n’est envoyé. Saisissez les chiffres de votre choix.', 'Cette saisie reste hors de la conversation : l’assistant ne la voit pas.'];
    for (const note of notes) expect(screen.getByText(note)).toBeInTheDocument();
    const code = await toCodeStep();
    for (const note of notes) expect(screen.getByText(note)).toBeInTheDocument();
    replies.push({ status: 200, body: {} });
    await userEvent.type(code, '99');
    await userEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    // Only the two sign-in routes are called: nothing goes to the conversation.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/auth/npi', '/auth/npi/verify']);
  });
});
