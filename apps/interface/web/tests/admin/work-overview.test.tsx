process.env.TZ = 'UTC';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    expect(within(tile('Délai médian')).getByText('1 j 6 h')).toBeInTheDocument();
    expect(screen.queryByText('Sans réponse')).toBeNull();
    expect(screen.getByText('Complément demandé')).toBeInTheDocument();
    expect(screen.getByText('Rejetés')).toBeInTheDocument();
    expect(screen.queryByText('30 derniers jours')).toBeNull();
    expect(screen.queryByText('à traiter maintenant')).toBeNull();
    expect(screen.queryByText('du dépôt à la fin')).toBeNull();
    expect(screen.queryByRole('link', { name: /Voir les dossiers|sans réponse/ })).toBeNull();
  });

  it('shows Complétés as one legend row, without a status subtitle or a request count', async () => {
    stubOverview({ completed: 25, completedByAssistant: 18 });
    render(<WorkOverview />);
    await screen.findByText('Reçus');
    const dossiers = screen.getByRole('heading', { name: 'Dossiers' }).closest('section')!;
    const row = within(dossiers).getByRole('link', { name: /Complétés/ });
    expect(within(row).getByText('Complétés')).toBeInTheDocument();
    expect(within(row).getByText('71 %')).toBeInTheDocument();
    expect(within(row).getByText('25')).toBeInTheDocument();
    expect(within(row).queryByText(/assistant|agent/)).toBeNull();
    expect(screen.queryByText('par statut')).toBeNull();
    expect(screen.queryByText(/\d+ demandes/)).toBeNull();
  });

  it('shows a dash for an unknown median', async () => {
    stubOverview({ medianProcessingHours: null }, 1);
    render(<WorkOverview />);
    await screen.findByText('Reçus');
    expect(within(tile('Délai médian')).getByText('-')).toBeInTheDocument();
    expect(screen.queryByText('Sans réponse')).toBeNull();
  });

  it('keeps the recent-queue title, filters and search outside the table card', async () => {
    stubOverview();
    render(<WorkOverview />);
    await screen.findAllByText(/Casier judiciaire/);

    const heading = screen.getByRole('heading', { name: /Dossiers récents/ });
    const title = within(heading).getByRole('link', { name: 'Dossiers récents' });
    expect(title).toHaveAttribute('href', '/admin/complete');
    expect(title).toHaveClass('cursor-pointer', 'no-underline', 'hover:underline');
    const badge = within(heading).getByText('1');
    expect(badge.className).toContain('rounded-full');
    expect(badge.className).toContain('bg-sunken');
    expect(screen.queryByRole('link', { name: 'Voir tout' })).toBeNull();
    const card = screen.getByRole('table', { name: 'Dossiers récents' }).closest('section')!;
    expect(card.contains(heading)).toBe(false);
    expect(card.querySelector('header')).toBeNull();
    expect(within(card).queryByRole('textbox', { name: 'Rechercher un dossier' })).toBeNull();
    expect(card.contains(screen.getByRole('button', { name: 'Rechercher un dossier' }))).toBe(false);
    expect(card.contains(screen.getByRole('button', { name: 'Tous' }))).toBe(false);
    expect(screen.getByRole('button', { name: 'Tous' })).toHaveAccessibleName('Tous');
    expect(screen.getByRole('button', { name: 'En attente' })).toHaveAccessibleName('En attente');
    expect(screen.getByRole('button', { name: 'Complété' })).toHaveAccessibleName('Complété');
    expect(screen.queryByRole('textbox', { name: 'Rechercher un dossier' })).toBeNull();
  });

  it('lists the top procedures', async () => {
    stubOverview();
    render(<WorkOverview />);
    await screen.findByText('Casier judiciaire');
    const top = screen.getByRole('heading', { name: 'Démarches les plus demandées' }).closest('section')!;
    expect(within(top).getByText('22')).toBeInTheDocument();
    expect(within(top).getByText('Acte de naissance sécurisé')).toBeInTheDocument();
    expect(within(tile('Reçus')).queryByText(/Web|WhatsApp/)).toBeNull();
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
      expect(c.url.searchParams.get('limit')).toBe('8');
    }
  });

  it('hides the case tiles and links without cases:read', async () => {
    resetConsole(['officials:read']);
    const { calls } = stubOverview();
    render(<WorkOverview />);
    await screen.findByText('Reçus');
    expect(calls.some((c) => c.url.pathname.endsWith('/cases'))).toBe(false);
    for (const label of ['En attente', 'Reçus', 'Délai médian']) {
      expect(within(tile(label)).queryByRole('link')).toBeNull();
    }
  });

  it('swaps the donut center and highlights the legend row on hover and focus', async () => {
    const user = userEvent.setup();
    stubOverview();
    render(<WorkOverview />);
    await screen.findByText('Reçus');

    const section = screen.getByRole('heading', { name: 'Dossiers' }).closest('section')!;
    const center = () => within(section).getByRole('paragraph');
    expect(within(center()).getByText('35')).toBeInTheDocument();
    expect(within(center()).getByText('dossiers')).toBeInTheDocument();

    const row = within(section).getByRole('link', { name: /Rejetés/ });
    await user.hover(row);
    expect(within(center()).getByText('9 %')).toBeInTheDocument();
    expect(within(center()).getByText('Rejetés')).toBeInTheDocument();
    expect(within(center()).queryByText('dossiers')).toBeNull();
    expect(within(row).getByText('9 %')).toBeInTheDocument();
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(row).toHaveAttribute('data-active', 'true');
    expect(row.style.backgroundColor).toContain('var(--color-flag-red)');
    const slice = section.querySelector('[data-slice="rejected"]') as HTMLElement;
    expect(slice.style.getPropertyValue('--slice-x')).not.toBe('0px');
    expect(within(section).getByRole('link', { name: /En vérification/ })).toHaveAttribute('data-active', 'false');

    await user.unhover(row);
    expect(within(center()).getByText('35')).toBeInTheDocument();
    expect(within(center()).getByText('dossiers')).toBeInTheDocument();
    expect(row).toHaveAttribute('data-active', 'false');
    expect(slice.style.getPropertyValue('--slice-x')).toBe('0px');

    await user.hover(slice);
    expect(row).toHaveAttribute('data-active', 'true');
    expect(within(center()).getByText('9 %')).toBeInTheDocument();
    await user.unhover(slice);
    expect(within(center()).getByText('dossiers')).toBeInTheDocument();

    await user.tab();
    const first = within(section).getByRole('link', { name: /En vérification/ });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('data-active', 'true');
    expect(within(center()).getByText('14 %')).toBeInTheDocument();
    expect(within(center()).getByText('En vérification')).toBeInTheDocument();
    await user.tab({ shift: true });
    expect(within(center()).getByText('dossiers')).toBeInTheDocument();
  });

  it('keeps the donut legend focusable without cases:read', async () => {
    const user = userEvent.setup();
    resetConsole(['officials:read']);
    stubOverview();
    render(<WorkOverview />);
    await screen.findByText('Reçus');
    const section = screen.getByRole('heading', { name: 'Dossiers' }).closest('section')!;
    const row = within(section).getByRole('button', { name: /Complétés/ });
    expect(row.tabIndex).toBeGreaterThanOrEqual(0);
    await user.tab();
    await user.tab();
    await user.tab();
    expect(row).toHaveFocus();
    expect(row).toHaveAttribute('data-active', 'true');
    expect(within(section).getByRole('paragraph').textContent).toContain('71 %');
    expect(within(section).getByRole('paragraph').textContent).toContain('Complétés');
    expect(within(row).getByText('25')).toBeInTheDocument();
  });

  it('shows an error with a retry when the dashboard fails', async () => {
    stubFetch(() => problem(503, 'UPSTREAM_UNAVAILABLE', 'indisponible'));
    render(<WorkOverview />);
    expect(await screen.findByText('Impossible de charger les indicateurs.')).toBeInTheDocument();
  });
});
