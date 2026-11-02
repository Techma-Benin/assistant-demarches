process.env.TZ = 'UTC';

import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkOverview } from '@/components/admin/work/overview';
import { formatDuration, formatPeriod } from '@/lib/admin/work-format';
import { json } from './helpers/c3-fetch';
import { item, resetConsole, stubFetch } from './helpers/work';

vi.mock('@/components/admin/console/console-context', async () => {
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

const dashboard = {
  departmentId: 'justice',
  period: { from: '2026-10-01T00:00:00Z', to: '2026-10-31T00:00:00Z' },
  received: 128,
  pending: 9,
  blocked: 2,
  completed: 119,
  completedByAi: 117,
  rejected: 0,
  overdue: 1,
  unanswered: 0,
  medianProcessingMs: 2 * 86_400_000 + 4 * 3_600_000,
  channels: [{ channel: 'whatsapp', count: 100 }, { channel: 'web', count: 28 }],
  mostRequested: [{ title: 'Casier judiciaire', count: 60 }],
};

function route(simulation: boolean) {
  return stubFetch((call) => {
    if (call.url.pathname.endsWith('/dashboard')) return json(dashboard);
    const status = call.url.searchParams.get('status');
    return json({
      items:
        status === 'completed'
          ? [item({ id: 'c', title: 'Acte de naissance', status: 'completed', completedBy: 'ai', simulation: false })]
          : [item({ id: 'p', simulation })],
      nextCursor: null,
    });
  });
}

describe('Vue d’ensemble', () => {
  it('shows the dashboard counters', async () => {
    const { calls } = route(true);
    render(<WorkOverview />);
    const counter = async (label: string) => (await screen.findByText(label, { selector: 'dt' })).parentElement!;
    expect(await counter('Reçus')).toHaveTextContent('128');
    const pending = await counter('En attente');
    expect(pending).toHaveTextContent('9');
    // Blocked and overdue are shown as the share of pending dossiers that needs attention.
    expect(pending).toHaveTextContent('2 bloqués');
    expect(pending).toHaveTextContent('1 en retard');
    expect(within(pending).getByRole('link', { name: /Voir les dossiers/ })).toHaveAttribute('href', '/admin/a-verifier');
    expect(await counter('Complétés par l’IA')).toHaveTextContent('117');
    expect(await counter('Complétés par l’IA')).toHaveTextContent('91 % des reçus');
    expect(await counter('Médiane de traitement')).toHaveTextContent('2 j 4 h');
    expect(screen.getByText(/^30 derniers jours/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.pathname.endsWith('/dashboard'))!.url.searchParams.get('departmentId')).toBe('justice');
  });

  it('lists the recent pending and completed items with « Voir tout » links', async () => {
    const { calls } = route(true);
    render(<WorkOverview />);
    const pending = (await screen.findByRole('heading', { name: 'En attente (9)' })).closest('div')!;
    expect(await within(pending).findByText('Casier judiciaire — simulation')).toBeInTheDocument();
    expect(within(pending).getByRole('link', { name: /Voir tout/ })).toHaveAttribute('href', '/admin/a-verifier');
    const done = screen.getByRole('heading', { name: 'Complété' }).closest('div')!;
    expect(await within(done).findByText('Acte de naissance')).toBeInTheDocument();
    expect(within(done).getByRole('link', { name: /Voir tout/ })).toHaveAttribute('href', '/admin/complete');
    const listCalls = calls.filter((c) => c.url.pathname.endsWith('/work-items'));
    expect(listCalls.map((c) => c.url.searchParams.get('limit'))).toEqual(['5', '5']);
  });

  it('shows the most requested documents and channels', async () => {
    route(false);
    render(<WorkOverview />);
    expect(await screen.findByText('Documents les plus demandés')).toBeInTheDocument();
    expect(screen.getByText('Casier judiciaire')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
  });

  it('shows « Valeurs fictives » only when a listed item is a simulation', async () => {
    route(true);
    const first = render(<WorkOverview />);
    expect(await screen.findByText(/Valeurs fictives/)).toBeInTheDocument();
    first.unmount();
    route(false);
    render(<WorkOverview />);
    await screen.findByText('Reçus', { selector: 'dt' });
    await screen.findByText('Acte de naissance');
    expect(screen.queryByText(/Valeurs fictives/)).not.toBeInTheDocument();
  });

  it('asks a super admin without department to choose a ministry', () => {
    resetConsole({ departmentId: null, isSuperAdmin: true });
    const { fetchMock } = route(false);
    render(<WorkOverview />);
    expect(screen.getByText('Choisissez un ministère')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('work formatters', () => {
  it('formats durations', () => {
    expect(formatDuration(2 * 86_400_000 + 4 * 3_600_000)).toBe('2 j 4 h');
    expect(formatDuration(3 * 3_600_000)).toBe('3 h');
    expect(formatDuration(null)).toBe('-');
  });
  it('formats the period', () => {
    expect(formatPeriod(dashboard.period)).toBe('30 derniers jours');
  });
});
