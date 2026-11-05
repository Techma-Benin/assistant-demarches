process.env.TZ = 'UTC';

import { fireEvent, render, screen, within } from '@testing-library/react';
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
  it('shows reference, channel chip, status, assignee, and dates', async () => {
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
    const cells = within(first).getAllByRole('cell');
    expect(within(first).getByText('SIM-JUS-2026-000001')).toBeInTheDocument();
    expect(within(first).queryByText('Simulation')).toBeNull();
    expect(within(cells[1]).getByText('WhatsApp')).toBeInTheDocument();
    expect(within(cells[2]).getByText('En vérification')).toBeInTheDocument();
    expect(within(cells[2]).queryByText(/pris en charge/)).toBeNull();
    expect(within(cells[3]).getByText('Agent Justice')).toBeInTheDocument();
    expect(within(cells[3]).queryByText(/pris en charge par/)).toBeNull();
    expect(within(first).getByRole('link')).toHaveAttribute('href', '/admin/dossiers/cas_01JD0000000000000000000001');
    const web = row('Acte de naissance sécurisé');
    expect(within(web).getByText('Web')).toBeInTheDocument();
    expect(within(web).queryByText('Simulation')).toBeNull();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Dossier',
      'Canal',
      'Statut',
      'Pris en charge',
      'Reçu',
      'Mis à jour',
    ]);
  });

  it('marks who completed a completed case in Pris en charge, not under the status', async () => {
    stubFetch(() =>
      page([
        caseItem({ id: 'cas_01JD0000000000000000000021', title: 'Par IA', status: 'completed', completedBy: 'assistant' }),
        caseItem({ id: 'cas_01JD0000000000000000000022', title: 'Par agent', status: 'completed', completedBy: 'administration' }),
      ]),
    );
    render(<WorkList view="completed" />);
    await screen.findByRole('link', { name: 'Par IA' });
    const ia = within(row('Par IA')).getAllByRole('cell');
    const agent = within(row('Par agent')).getAllByRole('cell');
    expect(within(ia[2]).queryByText(/assistant/)).toBeNull();
    expect(within(agent[2]).queryByText(/administration/)).toBeNull();
    expect(within(ia[3]).getByText('par l’assistant')).toBeInTheDocument();
    expect(within(agent[3]).getByText('par l’administration')).toBeInTheDocument();
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

  it('sorts rows when a column header is pressed', async () => {
    stubFetch(() =>
      page([
        caseItem({
          id: 'cas_01JD0000000000000000000041',
          title: 'Zèbre',
          createdAt: '2026-11-01T09:00:00Z',
          updatedAt: '2026-11-01T09:00:00Z',
        }),
        caseItem({
          id: 'cas_01JD0000000000000000000042',
          title: 'Abeille',
          createdAt: '2026-11-03T09:00:00Z',
          updatedAt: '2026-11-03T09:00:00Z',
        }),
      ]),
    );
    render(<WorkList view="pending" />);
    await screen.findByRole('link', { name: 'Zèbre' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Dossier' }));
    const links = screen.getAllByRole('link', { name: /Zèbre|Abeille/ });
    expect(links.map((link) => link.textContent)).toEqual(['Abeille', 'Zèbre']);
    await user.click(screen.getByRole('button', { name: 'Dossier' }));
    expect(screen.getAllByRole('link', { name: /Zèbre|Abeille/ }).map((link) => link.textContent)).toEqual([
      'Zèbre',
      'Abeille',
    ]);
  });

  it('shows no overdue, blocked or due-date figure', async () => {
    stubFetch(() => page([caseItem()]));
    render(<WorkList view="pending" />);
    await screen.findByRole('link', { name: /Casier/ });
    expect(screen.queryByText(/retard|bloqué|Échéance/i)).toBeNull();
  });
});

describe('queue chrome', () => {
  it('puts the count, status filters and search icon in the page header, outside the table card', async () => {
    stubFetch(() =>
      page([
        caseItem({ id: 'cas_01JD0000000000000000000051', title: 'Nouveau', status: 'received' }),
        caseItem({ id: 'cas_01JD0000000000000000000052', title: 'En cours', status: 'in_review' }),
        caseItem({ id: 'cas_01JD0000000000000000000053', title: 'Complément', status: 'information_requested' }),
      ]),
    );
    render(<WorkList view="pending" />);
    await screen.findByRole('link', { name: 'Nouveau' });

    const heading = screen.getByRole('heading', { level: 1, name: /En attente\s*3/ });
    const pageHeader = heading.closest('header')!;
    const card = screen.getByRole('table', { name: 'En attente' }).closest('section')!;

    expect(screen.queryByRole('heading', { level: 2, name: /En attente/ })).toBeNull();
    expect(card.querySelector('header')).toBeNull();
    expect(within(card).queryByRole('heading')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Rechercher un dossier' })).toBeNull();
    expect(within(card).queryByRole('textbox', { name: 'Rechercher un dossier' })).toBeNull();
    const search = within(pageHeader).getByRole('button', { name: 'Rechercher un dossier' });
    const filter = within(pageHeader).getByRole('button', { name: 'Filtrer les dossiers' });
    const tous = within(pageHeader).getByRole('button', { name: 'Tous' });
    expect(search.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(filter.compareDocumentPosition(tous) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(pageHeader).getByRole('button', { name: 'Reçu' })).toBeInTheDocument();
    expect(within(pageHeader).getByRole('button', { name: 'En vérification' })).toBeInTheDocument();
    expect(within(pageHeader).getByRole('button', { name: 'Complément demandé' })).toBeInTheDocument();
    expect(search.compareDocumentPosition(tous) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Filtrer les dossiers' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Rechercher un dossier' })).toBeNull();

    expect(heading.className).toContain('items-center');
    const badge = within(heading).getByText('3');
    expect(badge.className).toContain('rounded-full');
    expect(badge.className).toContain('bg-sunken');

    const indicator = pageHeader.querySelector('[data-chip-indicator]') as HTMLElement;
    expect(indicator).toBeTruthy();
    expect(indicator.className).toContain('bg-action');
    expect(indicator.className).toContain('duration-[220ms]');
    expect(indicator.className).toContain('ease-(--ui-ease-drawer)');
    expect(indicator.className).toContain('motion-reduce:transition-none');
  });

  it('filters from the revealed search field and hides it with Escape or clear once empty', async () => {
    stubFetch(() =>
      page([
        caseItem({ id: 'cas_01JD0000000000000000000061', title: 'Abeille', status: 'completed' }),
        caseItem({ id: 'cas_01JD0000000000000000000062', title: 'Zèbre', status: 'completed' }),
      ]),
    );
    render(<WorkList view="completed" />);
    await screen.findByRole('link', { name: 'Abeille' });
    expect(screen.getByRole('heading', { level: 1, name: /Complété\s*2/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /Complété/ })).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Rechercher un dossier' }));
    const field = screen.getByRole('textbox', { name: 'Rechercher un dossier' });
    await user.type(field, 'zèbre');
    expect(screen.queryByRole('link', { name: 'Abeille' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Zèbre' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(field).toHaveValue('');
    expect(screen.getByRole('link', { name: 'Abeille' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Rechercher un dossier' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Rechercher un dossier' }));
    await user.type(screen.getByRole('textbox', { name: 'Rechercher un dossier' }), 'abeille');
    await user.click(screen.getByRole('button', { name: 'Effacer la recherche' }));
    expect(screen.getByRole('textbox', { name: 'Rechercher un dossier' })).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Effacer la recherche' }));
    expect(screen.queryByRole('textbox', { name: 'Rechercher un dossier' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Rechercher un dossier' })).toBeInTheDocument();
  });

  it('filters every queue from the glass panel by channel, status and update date', async () => {
    stubFetch(() =>
      page([
        caseItem({
          id: 'cas_01JD0000000000000000000071',
          title: 'WhatsApp reçu',
          channel: 'whatsapp',
          status: 'received',
          createdAt: '2026-10-01T09:00:00Z',
          updatedAt: '2026-11-01T09:00:00Z',
        }),
        caseItem({
          id: 'cas_01JD0000000000000000000072',
          title: 'Web en cours',
          channel: 'web',
          status: 'in_review',
          createdAt: '2026-11-03T08:00:00Z',
          updatedAt: '2026-11-03T09:00:00Z',
        }),
        caseItem({
          id: 'cas_01JD0000000000000000000073',
          title: 'Web complément',
          channel: 'web',
          status: 'information_requested',
          createdAt: '2026-11-01T09:00:00Z',
          updatedAt: '2026-11-05T09:00:00Z',
        }),
      ]),
    );
    render(<WorkList view="pending" />);
    await screen.findByRole('link', { name: 'WhatsApp reçu' });
    const user = userEvent.setup();
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
    const search = within(header).getByRole('button', { name: 'Rechercher un dossier' });
    const filter = within(header).getByRole('button', { name: 'Filtrer les dossiers' });
    expect(search.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(filter);
    const dialog = screen.getByRole('dialog', { name: 'Filtres' });
    expect(dialog).toHaveClass('queue-filter-glass');
    expect(dialog).toHaveAttribute('data-glass', 'liquid');
    expect(dialog).toHaveAttribute('data-tint', 'gray');
    expect(dialog.className).toContain('z-10');
    const backdrop = document.querySelector('[data-filter-backdrop]')!;
    expect(backdrop.contains(dialog)).toBe(false);
    expect(dialog.contains(backdrop)).toBe(false);
    expect(backdrop.className).not.toContain('bg-black');
    for (let ancestor = dialog.parentElement; ancestor; ancestor = ancestor.parentElement) {
      expect(String(ancestor.className)).not.toContain('bg-black');
    }
    expect(dialog).toHaveFocus();
    expect(within(dialog).queryByRole('button', { name: 'Tous' })).toBeNull();
    expect(within(dialog).queryByRole('radio')).toBeNull();
    expect(within(dialog).queryByText(/réception/i)).toBeNull();
    expect(within(dialog).queryByText(/pris en charge/i)).toBeNull();

    await user.tab({ shift: true });
    expect(within(dialog).getByLabelText('Au')).toHaveFocus();

    const channel = within(dialog).getByRole('group', { name: 'Canal' });
    const whatsapp = within(channel).getByRole('button', { name: 'WhatsApp' });
    const web = within(channel).getByRole('button', { name: 'Web' });
    expect(whatsapp).toHaveAttribute('aria-pressed', 'false');
    expect(web.className).not.toContain('bg-action');
    await user.click(whatsapp);
    expect(whatsapp).toHaveAttribute('aria-pressed', 'true');
    expect(whatsapp.className).toContain('bg-action');
    expect(whatsapp.className).toContain('text-on-action');
    expect(web).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('link', { name: 'WhatsApp reçu' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Web en cours' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Web complément' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: /En attente\s*1/ })).toBeInTheDocument();

    await user.click(web);
    expect(screen.getByRole('link', { name: 'Web en cours' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Web complément' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /En attente\s*3/ })).toBeInTheDocument();

    await user.click(whatsapp);
    await user.click(web);
    const statut = within(dialog).getByRole('group', { name: 'Type de statut' });
    const inReview = within(statut).getByRole('button', { name: 'En vérification' });
    const received = within(statut).getByRole('button', { name: 'Reçu' });
    await user.click(inReview);
    expect(within(header).getByRole('button', { name: 'En vérification' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'Web en cours' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'WhatsApp reçu' })).toBeNull();

    await user.click(received);
    expect(inReview).toHaveAttribute('aria-pressed', 'true');
    expect(received).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'WhatsApp reçu' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Web en cours' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Web complément' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: /En attente\s*2/ })).toBeInTheDocument();

    await user.click(inReview);
    await user.click(received);
    const dates = within(dialog).getByRole('group', { name: 'Date de mise à jour' });
    fireEvent.change(within(dates).getByLabelText('Du'), { target: { value: '2026-11-04' } });
    expect(screen.getByRole('link', { name: 'Web complément' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Web en cours' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'WhatsApp reçu' })).toBeNull();

    fireEvent.change(within(dates).getByLabelText('Du'), { target: { value: '2026-11-01' } });
    fireEvent.change(within(dates).getByLabelText('Au'), { target: { value: '2026-11-01' } });
    expect(screen.getByRole('link', { name: 'WhatsApp reçu' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Web complément' })).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Réinitialiser' }));
    expect(screen.getByRole('link', { name: 'Web en cours' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /En attente\s*3/ })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Filtres' })).toBeNull();
    expect(filter).toHaveFocus();

    await user.click(filter);
    await user.click(document.querySelector('[data-filter-backdrop]')!);
    expect(screen.queryByRole('dialog', { name: 'Filtres' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Filtrer les dossiers' }));
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog', { name: 'Filtres' })).toBeNull();
  });

  it.each([
    ['completed', 'Complété', 'completed'],
    ['rejected', 'Rejeté', 'rejected'],
  ] as const)('puts the same filter on the %s list and applies it to those rows', async (view, title, status) => {
    stubFetch(() =>
      page([
        caseItem({
          id: 'cas_01JD0000000000000000000081',
          title: 'Par le web',
          channel: 'web',
          status,
          updatedAt: '2026-11-02T09:00:00Z',
        }),
        caseItem({
          id: 'cas_01JD0000000000000000000082',
          title: 'Par WhatsApp',
          channel: 'whatsapp',
          status,
          updatedAt: '2026-11-04T09:00:00Z',
        }),
      ]),
    );
    render(<WorkList view={view} />);
    await screen.findByRole('link', { name: 'Par le web' });
    const header = screen.getByRole('heading', { level: 1, name: new RegExp(title) }).closest('header')!;
    const search = within(header).getByRole('button', { name: 'Rechercher un dossier' });
    const filter = within(header).getByRole('button', { name: 'Filtrer les dossiers' });
    expect(search.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const user = userEvent.setup();
    await user.click(filter);
    const dialog = screen.getByRole('dialog', { name: 'Filtres' });
    expect(dialog).toHaveClass('queue-filter-glass');
    expect(dialog).toHaveAttribute('data-tint', 'gray');
    expect(within(dialog).getByRole('group', { name: 'Canal' })).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Type de statut' })).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Date de mise à jour' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: title })).toHaveAttribute('aria-pressed', 'false');
    expect(within(dialog).queryByRole('button', { name: 'Tous' })).toBeNull();
    expect(within(dialog).queryByText(/réception/i)).toBeNull();
    expect(within(dialog).queryByText(/pris en charge/i)).toBeNull();

    const whatsapp = within(within(dialog).getByRole('group', { name: 'Canal' })).getByRole('button', { name: 'WhatsApp' });
    await user.click(whatsapp);
    expect(screen.queryByRole('link', { name: 'Par le web' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Par WhatsApp' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: new RegExp(`${title}\\s*1`) })).toBeInTheDocument();
    await user.click(whatsapp);
    expect(whatsapp).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('link', { name: 'Par le web' })).toBeInTheDocument();
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
