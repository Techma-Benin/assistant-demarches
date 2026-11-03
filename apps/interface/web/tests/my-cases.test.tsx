import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaseDetail, MyCases } from '@/components/app/MyCases';
import { C1Error, type C1Client } from '@/lib/c1-client';
import { exampleCase, issuedCase } from './fixtures-v2';

const session = (user: unknown) => vi.fn(async () => new Response(JSON.stringify({ user }), { status: 200 }));
const second = { ...exampleCase, id: 'cas_01JD0000000000000000000002', reference: 'SIM-ANIP-2026-000002', title: 'Acte de naissance sécurisé', administrationId: 'anip', status: 'completed' as const };

beforeEach(() => {
  vi.stubGlobal('fetch', session({ name: 'Awa', roles: ['citizen'] }));
});
afterEach(() => vi.unstubAllGlobals());

describe('Mes démarches', () => {
  it('lists the cases with status, SIM reference and Simulation mark, administration and last update', async () => {
    const client = { listCases: vi.fn(async () => ({ items: [exampleCase, second], nextCursor: null })) };
    render(<MyCases client={client as unknown as C1Client} />);
    const list = await screen.findByRole('list', { name: 'Vos démarches' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('En cours d’examen')).toBeInTheDocument();
    expect(within(items[0]).getByText('SIM-JUS-2026-000001')).toBeInTheDocument();
    expect(within(items[0]).getByText('Simulation')).toBeInTheDocument();
    expect(items[0]).toHaveTextContent('Justice');
    expect(items[0]).toHaveTextContent('Mise à jour le 02/11/2026');
    expect(within(items[1]).getByText('Terminé')).toBeInTheDocument();
    expect(within(items[0]).getByRole('link', { name: exampleCase.title })).toHaveAttribute('href', `/demarches/${exampleCase.id}`);
    expect(client.listCases).toHaveBeenCalledWith(null);
  });

  it('loads the next page with the cursor', async () => {
    const listCases = vi
      .fn()
      .mockResolvedValueOnce({ items: [exampleCase], nextCursor: 'CURSOR2' })
      .mockResolvedValueOnce({ items: [second], nextCursor: null });
    render(<MyCases client={{ listCases } as unknown as C1Client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Voir plus' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(listCases).toHaveBeenLastCalledWith('CURSOR2');
    expect(screen.queryByRole('button', { name: 'Voir plus' })).toBeNull();
  });

  it('says so when there is nothing yet', async () => {
    render(<MyCases client={{ listCases: vi.fn(async () => ({ items: [], nextCursor: null })) } as unknown as C1Client} />);
    expect(await screen.findByText('Vous n’avez pas encore déposé de démarche.')).toBeInTheDocument();
  });

  it('asks a guest to log in, without calling the cases API', async () => {
    vi.stubGlobal('fetch', session(null));
    const client = { listCases: vi.fn() };
    render(<MyCases client={client as unknown as C1Client} />);
    expect(await screen.findByText('Connectez-vous pour voir vos démarches')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/auth/login?returnTo=%2Fdemarches');
    expect(client.listCases).not.toHaveBeenCalled();
  });

  it.each([401, 403])('shows the same prompt when the API answers %i', async (status) => {
    const client = { listCases: vi.fn(async () => Promise.reject(new C1Error(status))) };
    render(<MyCases client={client as unknown as C1Client} />);
    expect(await screen.findByText('Connectez-vous pour voir vos démarches')).toBeInTheDocument();
  });

  it('offers to retry after a failure', async () => {
    const listCases = vi.fn().mockRejectedValueOnce(new C1Error(503)).mockResolvedValue({ items: [exampleCase], nextCursor: null });
    render(<MyCases client={{ listCases } as unknown as C1Client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('list', { name: 'Vos démarches' })).toBeInTheDocument();
  });
});

describe('Mes démarches, detail', () => {
  it('shows the same content as the caseCard with the document download', async () => {
    const item = issuedCase();
    const client = { getCase: vi.fn(async () => item) };
    render(<CaseDetail caseId={item.id} client={client as unknown as C1Client} />);
    const card = await screen.findByRole('region', { name: 'État du dossier' });
    expect(client.getCase).toHaveBeenCalledWith(item.id);
    expect(within(card).getByText('Simulation')).toBeInTheDocument();
    expect(within(card).getByText('Terminé')).toBeInTheDocument();
    const issued = item.documents.find((d) => d.kind === 'issued')!;
    expect(within(card).getByRole('link', { name: /Extrait B3/ })).toHaveAttribute('href', `/api/backend/v1/cases/${item.id}/documents/${issued.id}`);
    expect(screen.getByRole('link', { name: 'Mes démarches' })).toHaveAttribute('href', '/demarches');
  });

  it('asks a guest to log in, and says when the case does not exist', async () => {
    const { unmount } = render(<CaseDetail caseId="cas_x" client={{ getCase: vi.fn(async () => Promise.reject(new C1Error(401))) } as unknown as C1Client} />);
    expect(await screen.findByText('Connectez-vous pour voir vos démarches')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/auth/login?returnTo=%2Fdemarches%2Fcas_x');
    unmount();
    render(<CaseDetail caseId="cas_x" client={{ getCase: vi.fn(async () => Promise.reject(new C1Error(404))) } as unknown as C1Client} />);
    expect(await screen.findByText('Cette démarche est introuvable.')).toBeInTheDocument();
  });
});
