process.env.TZ = 'UTC';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkList } from '@/components/work/work-list';
import { item, resetConsole, stubFetch } from './helpers/work';
import { json } from './helpers/c3-fetch';

vi.mock('@/components/console/console-context', async () => {
  const helpers = await import('./helpers/work');
  return { useConsole: () => helpers.consoleStub };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => resetConsole());
afterEach(() => vi.unstubAllGlobals());

const rowText = (text: string) => screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === text);

describe('À vérifier (issue #1 acceptance criteria)', () => {
  it('Justice agent sees « En attente (1) » and the row « Casier judiciaire — simulation · nouvelle demande · à vérifier »', async () => {
    const { calls } = stubFetch(() => json({ items: [item()], nextCursor: null }));
    render(<WorkList mode="pending" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'En attente (1)' })).toBeInTheDocument();
    expect(rowText('Casier judiciaire — simulation · nouvelle demande · à vérifier')).toBeInTheDocument();
    expect(screen.getByText('Simulation')).toBeInTheDocument();
    expect(screen.getByText('REC-0001')).toBeInTheDocument();
    expect(calls[0]!.url.searchParams.get('departmentId')).toBe('justice');
    expect(calls[0]!.url.searchParams.get('status')).toBe('pending');
    expect(screen.getByRole('link', { name: /Casier judiciaire/ })).toHaveAttribute(
      'href',
      '/dossiers/req_00000000000000000000000001',
    );
  });

  it('Enseignement agent sees « En attente (0) » and « Aucun dossier »', async () => {
    resetConsole({ departmentId: 'enseignement' });
    stubFetch(() => json({ items: [], nextCursor: null }));
    render(<WorkList mode="pending" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'En attente (0)' })).toBeInTheDocument();
    expect(screen.getByText('Aucun dossier')).toBeInTheDocument();
  });

  it('describes processing, blocked and overdue items', async () => {
    stubFetch(() =>
      json({
        items: [
          item({ id: 'a', title: 'Acte', status: 'processing', assignedTo: 'Awa', simulation: false }),
          item({
            id: 'b',
            title: 'Permis',
            status: 'blocked',
            blocking: { code: 'PAYMENT', detail: 'paiement échoué', at: '2026-10-30T09:40:00Z' },
            dueAt: '2020-01-01T00:00:00Z',
            simulation: false,
          }),
        ],
        nextCursor: null,
      }),
    );
    render(<WorkList mode="pending" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'En attente (2)' })).toBeInTheDocument();
    expect(rowText('Acte · en cours · pris en charge par Awa')).toBeInTheDocument();
    expect(rowText('Permis · bloqué · paiement échoué')).toBeInTheDocument();
    expect(screen.getByText(/En retard/)).toBeInTheDocument();
    expect(screen.queryByText('Simulation')).not.toBeInTheDocument();
  });

  it('loads more with the cursor', async () => {
    const { calls } = stubFetch((call) =>
      call.url.searchParams.get('cursor')
        ? json({ items: [item({ id: 'b', title: 'Deuxième' })], nextCursor: null })
        : json({ items: [item({ id: 'a', title: 'Premier' })], nextCursor: 'next' }),
    );
    render(<WorkList mode="pending" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Charger plus' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'En attente (2)' })).toBeInTheDocument();
    expect(calls[1]!.url.searchParams.get('cursor')).toBe('next');
  });

  it('shows an error with Réessayer', async () => {
    let fail = true;
    stubFetch(() => (fail ? new Response('x', { status: 500 }) : json({ items: [], nextCursor: null })));
    render(<WorkList mode="pending" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Aucun dossier')).toBeInTheDocument();
  });

  it('asks a super admin without department to choose one', () => {
    resetConsole({ departmentId: null, isSuperAdmin: true });
    const { fetchMock } = stubFetch(() => json({ items: [], nextCursor: null }));
    render(<WorkList mode="pending" />);
    expect(screen.getByText('Choisissez un ministère')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Complété', () => {
  it('labels who completed each item and the empty state', async () => {
    stubFetch(() =>
      json({
        items: [
          item({ id: 'a', title: 'Acte de naissance', status: 'completed', completedBy: 'ai', completedAt: '2026-10-30T10:00:00Z' }),
          item({ id: 'b', title: 'Casier', status: 'completed', completedBy: 'human', completedAt: '2026-10-30T10:00:00Z' }),
        ],
        nextCursor: null,
      }),
    );
    render(<WorkList mode="completed" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Complété' })).toBeInTheDocument();
    expect(rowText('Acte de naissance · par l’IA')).toBeInTheDocument();
    expect(rowText('Casier · par un agent')).toBeInTheDocument();
    expect(screen.getAllByText(/^Complété /)).toHaveLength(2);
  });

  it('shows « Aucun dossier complété » when empty', async () => {
    const { calls } = stubFetch(() => json({ items: [], nextCursor: null }));
    render(<WorkList mode="completed" />);
    expect(await screen.findByText('Aucun dossier complété')).toBeInTheDocument();
    expect(calls[0]!.url.searchParams.get('status')).toBe('completed');
  });
});

