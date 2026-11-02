process.env.TZ = 'UTC';

import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkOverview } from '@/components/admin/work/overview';
import { SUPER, caseItem, dashboard, json, problem, resetConsole, stubFetch } from './helpers/fixtures';

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

const tile = (label: string) => screen.getByText(label, { selector: 'dt' }).parentElement!;

function stubOverview(metrics = {}, unanswered = 4) {
  return stubFetch((call) => {
    if (call.url.pathname.endsWith('/dashboard')) return json(dashboard(metrics, unanswered));
    return json({ items: [caseItem()], nextCursor: null });
  });
}

describe('Vue d’ensemble (A2)', () => {
  it('shows the dashboard figures of v2', async () => {
    stubOverview();
    render(<WorkOverview />);
    await screen.findByText('Reçus');
    expect(within(tile('En attente')).getByText('7')).toBeInTheDocument();
    expect(within(tile('Reçus')).getByText('40')).toBeInTheDocument();
    expect(within(tile('Complément demandé')).getByText('2')).toBeInTheDocument();
    expect(within(tile('Rejetés')).getByText('3')).toBeInTheDocument();
    expect(within(tile('Complétés par l’assistant')).getByText('18')).toBeInTheDocument();
    expect(within(tile('Délai médian')).getByText('1 j 6 h')).toBeInTheDocument();
    expect(screen.getByText('30 derniers jours')).toBeInTheDocument();
  });

  it('computes « Complétés par un agent » as completed − completedByAssistant', async () => {
    stubOverview({ completed: 25, completedByAssistant: 18 });
    render(<WorkOverview />);
    await screen.findByText('Reçus');
    expect(within(tile('Complétés par un agent')).getByText('7')).toBeInTheDocument();
  });

  it('shows the open unanswered count and a dash for an unknown median', async () => {
    stubOverview({ medianProcessingHours: null }, 1);
    render(<WorkOverview />);
    await screen.findByText('Reçus');
    expect(within(tile('Délai médian')).getByText('-')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1 question sans réponse' })).toHaveAttribute('href', '/admin/sans-reponse');
  });

  it('lists the top procedures and the channels', async () => {
    stubOverview();
    render(<WorkOverview />);
    await screen.findByText('Casier judiciaire');
    const top = screen.getByRole('heading', { name: 'Démarches les plus demandées' }).parentElement!;
    expect(within(top).getByText('22')).toBeInTheDocument();
    expect(within(top).getByText('Acte de naissance sécurisé')).toBeInTheDocument();
    const channels = screen.getByRole('heading', { name: 'Canaux' }).parentElement!;
    expect(within(channels).getByText('Web')).toBeInTheDocument();
    expect(within(channels).getByText('WhatsApp')).toBeInTheDocument();
    expect(within(channels).getByText('31')).toBeInTheDocument();
  });

  it('shows no figure v2 does not provide: overdue, blocked, simulated values', async () => {
    stubOverview();
    render(<WorkOverview />);
    await screen.findByText('Reçus');
    expect(screen.queryByText(/retard|bloqué|fictives|Complétés par l’IA/i)).toBeNull();
  });

  it('requests the dashboard and the recent cases with the chosen administration (super admin)', async () => {
    resetConsole(SUPER, { scopeId: 'anip' });
    const { calls } = stubOverview();
    render(<WorkOverview />);
    await screen.findByText('Reçus');
    await screen.findAllByText(/Casier judiciaire/);
    const dash = calls.find((c) => c.url.pathname.endsWith('/dashboard'))!;
    expect(dash.url.searchParams.get('administrationId')).toBe('anip');
    const cases = calls.filter((c) => c.url.pathname.endsWith('/cases'));
    expect(cases.map((c) => c.url.searchParams.get('view')).sort()).toEqual(['completed', 'pending']);
    for (const c of cases) {
      expect(c.url.searchParams.get('administrationId')).toBe('anip');
      expect(c.url.searchParams.get('limit')).toBe('5');
    }
  });

  it('hides the case tiles and links without cases:read', async () => {
    resetConsole(['officials:read']);
    const { calls } = stubOverview();
    render(<WorkOverview />);
    await screen.findByText('Reçus');
    expect(calls.some((c) => c.url.pathname.endsWith('/cases'))).toBe(false);
    expect(screen.queryByRole('link', { name: /Voir les dossiers/ })).toBeNull();
  });

  it('shows an error with a retry when the dashboard fails', async () => {
    stubFetch(() => problem(503, 'UPSTREAM_UNAVAILABLE', 'indisponible'));
    render(<WorkOverview />);
    expect(await screen.findByText('Impossible de charger les indicateurs.')).toBeInTheDocument();
  });
});
