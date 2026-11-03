process.env.TZ = 'UTC';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkList } from '@/components/admin/work/work-list';
import { OFFICIAL_ID, SUPER, caseItem, json, resetConsole, stubFetch } from './helpers/fixtures';

vi.mock('@/components/admin/console/console-context', async () => (await import('./helpers/fixtures')).consoleModule());
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => resetConsole());
afterEach(() => vi.unstubAllGlobals());

const page = (items: unknown[], nextCursor: string | null = null) => json({ items, nextCursor });
const row = (name: RegExp | string) => screen.getByRole('link', { name }).closest('tr')!;

describe('case tabs', () => {
  it.each([
    ['pending', 'En attente', 'Aucun dossier en attente'],
    ['completed', 'Complété', 'Aucun dossier complété'],
    ['rejected', 'Rejeté', 'Aucun dossier rejeté'],
  ] as const)('%s tab requests view=%s and shows its empty state', async (view, title, empty) => {
    const { calls } = stubFetch(() => page([]));
    render(<WorkList view={view} />);
    expect(await screen.findByText(empty)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe('/api/admin/v1/admin/cases');
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ view, limit: '20' });
  });

  it('lists the three pending statuses in one tab, with the French labels', async () => {
    stubFetch(() =>
      page([
        caseItem({ id: 'cas_01JD0000000000000000000011', title: 'Nouveau', status: 'received' }),
        caseItem({ id: 'cas_01JD0000000000000000000012', title: 'En cours', status: 'in_review' }),
        caseItem({ id: 'cas_01JD0000000000000000000013', title: 'Complément', status: 'information_requested' }),
      ]),
    );
    render(<WorkList view="pending" />);
    await screen.findByRole('link', { name: 'Nouveau' });
    expect(within(row('Nouveau')).getAllByText('Reçu').length).toBeGreaterThan(0);
    expect(within(row('En cours')).getByText('En vérification')).toBeInTheDocument();
    expect(within(row('Complément')).getByText('Complément demandé')).toBeInTheDocument();
  });

  it('sends the chosen administration only for a super admin', async () => {
    resetConsole(SUPER, { scopeId: 'anip' });
    const { calls } = stubFetch(() => page([]));
    render(<WorkList view="pending" />);
    await screen.findByText('Aucun dossier en attente');
    expect(calls[0].url.searchParams.get('administrationId')).toBe('anip');
  });

  it('asks the agent nothing about the administration', async () => {
    const { calls } = stubFetch(() => page([]));
    render(<WorkList view="pending" />);
    await screen.findByText('Aucun dossier en attente');
    expect(calls[0].url.searchParams.has('administrationId')).toBe(false);
  });
});

describe('case rows', () => {
  it('shows reference, Simulation mark, procedure, channel, status and dates', async () => {
    stubFetch(() =>
      page([
        caseItem({ channel: 'whatsapp', claimedBy: OFFICIAL_ID }),
        caseItem({
          id: 'cas_01JD0000000000000000000002',
          reference: 'SIM-ANI-2026-000002',
          simulated: true,
          title: 'Acte de naissance sécurisé',
          channel: 'web',
          status: 'received',
        }),
      ]),
    );
    render(<WorkList view="pending" />);
    await screen.findByRole('link', { name: /Casier judiciaire/ });
    const first = row(/Casier judiciaire/);
    expect(within(first).getByText('SIM-JUS-2026-000001')).toBeInTheDocument();
    expect(within(first).getByText('Simulation')).toBeInTheDocument();
    expect(within(first).getByText('WhatsApp')).toBeInTheDocument();
    expect(within(first).getByText('En vérification')).toBeInTheDocument();
    expect(within(first).getByText('pris en charge par Agent Justice')).toBeInTheDocument();
    expect(within(first).getByRole('link')).toHaveAttribute('href', '/admin/dossiers/cas_01JD0000000000000000000001');
    expect(within(row('Acte de naissance sécurisé')).getByText('Web')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Dossier',
      'Canal',
      'Statut',
      'Reçu',
      'Mis à jour',
    ]);
  });

  it('marks who completed a completed case', async () => {
    stubFetch(() =>
      page([
        caseItem({ id: 'cas_01JD0000000000000000000021', title: 'Par IA', status: 'completed', completedBy: 'assistant' }),
        caseItem({ id: 'cas_01JD0000000000000000000022', title: 'Par agent', status: 'completed', completedBy: 'administration' }),
      ]),
    );
    render(<WorkList view="completed" />);
    await screen.findByRole('link', { name: 'Par IA' });
    expect(within(row('Par IA')).getByText('par l’assistant')).toBeInTheDocument();
    expect(within(row('Par agent')).getByText('par l’administration')).toBeInTheDocument();
  });

  it('does not mark a non-simulated case as a simulation', async () => {
    stubFetch(() => page([caseItem({ simulated: false as unknown as true })]));
    render(<WorkList view="pending" />);
    await screen.findByRole('link', { name: /Casier/ });
    expect(screen.queryByText('Simulation')).toBeNull();
  });

  it('loads the next page with the cursor', async () => {
    const { calls } = stubFetch((call) =>
      call.url.searchParams.get('cursor')
        ? page([caseItem({ id: 'cas_01JD0000000000000000000031', title: 'Deuxième page' })])
        : page([caseItem({ title: 'Première page' })], 'c1'),
    );
    render(<WorkList view="pending" />);
    await screen.findByRole('link', { name: 'Première page' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Charger plus' }));
    expect(await screen.findByRole('link', { name: 'Deuxième page' })).toBeInTheDocument();
    expect(calls[1].url.searchParams.get('cursor')).toBe('c1');
  });

  it('shows no overdue, blocked or due-date figure', async () => {
    stubFetch(() => page([caseItem()]));
    render(<WorkList view="pending" />);
    await screen.findByRole('link', { name: /Casier/ });
    expect(screen.queryByText(/retard|bloqué|Échéance/i)).toBeNull();
  });
});

describe('permission gating', () => {
  it('shows a notice and fetches nothing without cases:read', async () => {
    resetConsole(['officials:read']);
    const { calls } = stubFetch(() => page([]));
    render(<WorkList view="pending" />);
    expect(screen.getByText('Vous n’avez pas accès à cette page.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('asks a super admin without any connected administration to wait', async () => {
    resetConsole(SUPER, { scopeId: undefined, administrationId: null, administration: null });
    const { calls } = stubFetch(() => page([]));
    render(<WorkList view="pending" />);
    expect(await screen.findByText('Aucune administration connectée')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
