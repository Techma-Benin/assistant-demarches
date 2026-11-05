import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleProvider } from '@/components/admin/console/console-context';
import { PageHeader } from '@/components/admin/page-header';
import { ReportActiveCaseStatus } from '@/components/admin/shell/active-case-status';
import { AppShell } from '@/components/admin/shell/app-shell';
import type { CaseStatus } from '@/lib/admin/api';
import { ADMIN, AGENT, ANIP, JUSTICE, SANTE, SUPER, SUPER_ME, me, stubConsole } from './helpers/fixtures';

let pathname = '/admin';
const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => router }));

beforeEach(() => {
  pathname = '/admin';
  router.push.mockClear();
  router.refresh.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function renderShell(administrationId: string | null = null, caseStatus?: CaseStatus | null) {
  return render(
    <ConsoleProvider initialAdministrationId={administrationId}>
      <AppShell>
        {caseStatus !== undefined ? <ReportActiveCaseStatus status={caseStatus} /> : null}
        contenu
      </AppShell>
    </ConsoleProvider>,
  );
}

const navLinks = () =>
  Array.from(screen.getByRole('navigation', { name: 'Navigation principale' }).querySelectorAll('a')).map((a) =>
    a.getAttribute('href'),
  );

describe('AppShell navigation', () => {
  it('shows the business nav for an agent: three case tabs, no Utilisateurs', async () => {
    stubConsole({ me: me(AGENT) });
    pathname = '/admin/complete';
    renderShell();
    expect(await screen.findByText('contenu')).toBeInTheDocument();
    expect(navLinks()).toEqual([
      '/admin',
      '/admin/en-attente',
      '/admin/complete',
      '/admin/rejete',
      '/admin/journal',
      '/admin/profil',
    ]);
    expect(screen.getByRole('link', { name: 'Complété' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Rejeté' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('link', { name: 'Utilisateurs' })).toBeNull();
    expect(screen.queryByText('Opérateur')).toBeNull();
  });

  it('shows Utilisateurs only with officials:read', async () => {
    stubConsole({ me: me(ADMIN) });
    renderShell();
    expect(await screen.findByRole('link', { name: 'Utilisateurs' })).toHaveAttribute('href', '/admin/utilisateurs');
  });

  it('hides the case tabs without cases:read', async () => {
    stubConsole({ me: me(['officials:read']) });
    renderShell();
    await screen.findByText('contenu');
    expect(navLinks()).toEqual(['/admin', '/admin/journal', '/admin/utilisateurs', '/admin/profil']);
  });

  it('shows the pending count from dashboard.metrics.pending, not from a list', async () => {
    const { calls } = stubConsole({ me: me(AGENT), pending: 3 });
    renderShell();
    expect(await screen.findByRole('link', { name: 'En attente, 3 à traiter' })).toBeInTheDocument();
    expect(calls.filter((call) => call.url.includes('/cases'))).toHaveLength(0);
    const dashboards = calls.filter((call) => call.url.includes('/v1/admin/dashboard'));
    expect(dashboards).toHaveLength(1);
    expect(dashboards[0].url).not.toContain('administrationId');
  });

  it('sends the chosen administration for the pending count of a super admin', async () => {
    const { calls } = stubConsole({ me: SUPER_ME, administrations: [JUSTICE, ANIP], pending: 5 });
    renderShell('anip');
    expect(await screen.findByRole('link', { name: 'En attente, 5 à traiter' })).toBeInTheDocument();
    expect(calls.find((call) => call.url.includes('/dashboard'))?.url).toContain('administrationId=anip');
  });

  it.each([
    [undefined, 'En attente'],
    ['received', 'En attente'],
    ['in_review', 'En attente'],
    ['information_requested', 'En attente'],
    ['completed', 'Complété'],
    ['rejected', 'Rejeté'],
  ] as const)('highlights %s dossier on %s', async (status, label) => {
    stubConsole({ me: me(AGENT) });
    pathname = '/admin/dossiers/abc';
    renderShell(null, status);
    expect(await screen.findByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    for (const other of ['En attente', 'Complété', 'Rejeté'] as const) {
      if (other === label) continue;
      expect(screen.getByRole('link', { name: other })).not.toHaveAttribute('aria-current');
    }
  });

  it('shows an error with a retry when the profile cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('down'))));
    renderShell();
    expect(await screen.findByText('Impossible de charger votre profil. Réessayez.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('toggles the mobile menu with aria-expanded', async () => {
    stubConsole({ me: me(AGENT) });
    renderShell();
    const button = screen.getByRole('button', { name: 'Ouvrir le menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('console-nav')).toHaveAttribute('inert');
    await userEvent.setup().click(button);
    expect(screen.getByRole('button', { name: 'Fermer le menu' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('console-nav')).not.toHaveAttribute('inert');
    expect(within(document.getElementById('console-nav')!).getByRole('button', { name: 'Agent Justice' })).toBeInTheDocument();
  });
});

describe('administration selector', () => {
  it('shows the administration as static text for an agent', async () => {
    stubConsole({ me: me(AGENT) });
    renderShell();
    expect(await screen.findByLabelText('Administration : Ministère de la Justice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ministère de la Justice' })).toBeNull();
  });

  async function openAdministrationPicker(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Sam Super' }));
    await user.click(screen.getByRole('menuitem', { name: /Ministère de la Justice/ }));
    return screen.getByRole('menu', { name: 'Changer d’administration' });
  }

  it('lets a super admin pick a connected administration and posts the choice', async () => {
    const { calls } = stubConsole({ me: SUPER_ME, administrations: [JUSTICE, ANIP] });
    renderShell();
    const user = userEvent.setup();
    const menu = await openAdministrationPicker(user);
    await user.click(within(menu).getByRole('menuitemradio', { name: 'ANIP' }));
    expect(calls.find((call) => call.method === 'POST')).toMatchObject({
      url: '/api/admin-administration',
      body: { administrationId: 'anip' },
    });
    expect(router.push).toHaveBeenCalledWith('/admin');
    expect(await screen.findByText('Vous êtes maintenant : ANIP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sam Super' })).toHaveTextContent('ANIP');
  });

  it('does not list a not connected administration', async () => {
    const { calls } = stubConsole({ me: SUPER_ME, administrations: [JUSTICE, SANTE] });
    renderShell();
    const user = userEvent.setup();
    const menu = await openAdministrationPicker(user);
    expect(within(menu).queryByRole('menuitemradio', { name: /Santé/ })).toBeNull();
    expect(within(menu).getByRole('menuitemradio', { name: 'Ministère de la Justice' })).toBeEnabled();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('closes the menu with Escape', async () => {
    stubConsole({ me: SUPER_ME, administrations: [JUSTICE, ANIP] });
    renderShell();
    const user = userEvent.setup();
    await openAdministrationPicker(user);
    expect(screen.getByRole('menu', { name: 'Changer d’administration' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Changer d’administration' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Compte' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('asks nothing of a hidden selector: no administrations:all means no administrations request', async () => {
    const { calls } = stubConsole({ me: me(SUPER.filter((p) => p !== 'administrations:all')) });
    renderShell();
    await screen.findByText('contenu');
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.some((c) => c.url.includes('/administrations'))).toBe(false);
  });
});

describe('PageHeader', () => {
  it('shows the sample-data pill only when NEXT_PUBLIC_SAMPLE_DATA is true', () => {
    const { rerender } = render(<PageHeader title="T" description="d" actions={<button>Act</button>} />);
    expect(screen.queryByText('Données simulées')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'T' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument();
    vi.stubEnv('NEXT_PUBLIC_SAMPLE_DATA', 'true');
    rerender(<PageHeader title="T" />);
    expect(screen.getByText('Données simulées')).toBeInTheDocument();
  });
});
