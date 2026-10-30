import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleProvider } from '@/components/console/console-context';
import { AppShell } from '@/components/shell/app-shell';
import { PageHeader } from '@/components/page-header';
import { ENSEIGNEMENT, JUSTICE, SESSIONS, SUPER, profile, stubConsole } from './helpers/console-fetch';

let pathname = '/';
const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => router }));

beforeEach(() => {
  pathname = '/';
  router.push.mockClear();
  router.refresh.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function renderShell(sessionId = 'justice', departmentId: string | null = null) {
  return render(
    <ConsoleProvider initialSessions={SESSIONS} initialSessionId={sessionId} initialDepartmentId={departmentId}>
      <AppShell>contenu</AppShell>
    </ConsoleProvider>,
  );
}

const navLinks = () =>
  Array.from(screen.getByRole('navigation', { name: 'Navigation principale' }).querySelectorAll('a')).map((a) =>
    a.getAttribute('href'),
  );

describe('AppShell navigation', () => {
  it('shows the business nav for an agent: no Utilisateurs, no operator group, no Conversations', async () => {
    stubConsole({ profile: profile() });
    pathname = '/complete';
    renderShell();
    expect(await screen.findByText('contenu')).toBeInTheDocument();
    expect(navLinks()).toEqual(['/', '/a-verifier', '/complete', '/sans-reponse', '/journal', '/profil']);
    expect(screen.getByRole('link', { name: 'Complété' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Vue d’ensemble' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('link', { name: 'Utilisateurs' })).toBeNull();
    expect(screen.queryByText('Opérateur')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Conversations' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Fiches' })).toBeNull();
  });

  it('shows Utilisateurs to a super admin and to a department admin', async () => {
    stubConsole({ profile: SUPER, departments: [JUSTICE, ENSEIGNEMENT] });
    const { unmount } = renderShell('super');
    expect(await screen.findByRole('link', { name: 'Utilisateurs' })).toHaveAttribute('href', '/utilisateurs');
    unmount();
    stubConsole({ profile: profile({ memberships: [{ departmentId: 'justice', role: 'admin', active: true }] }) });
    renderShell();
    expect(await screen.findByRole('link', { name: 'Utilisateurs' })).toBeInTheDocument();
  });

  it('shows the operator group only with an operator permission', async () => {
    stubConsole({ profile: profile({ permissions: ['department:read', 'operator:read'] }) });
    renderShell();
    const group = await screen.findByRole('list', { name: 'Opérateur' });
    expect(within(group).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/procedures',
      '/models',
      '/tools',
      '/conversations',
      '/audit',
    ]);
  });

  it('shows the pending count from one work-items request', async () => {
    const { calls } = stubConsole({ profile: profile(), pending: 3 });
    renderShell();
    expect(await screen.findByRole('link', { name: 'À vérifier, 3 à traiter' })).toBeInTheDocument();
    const pendingCalls = calls.filter((call) => call.url.includes('work-items'));
    expect(pendingCalls).toHaveLength(1);
    expect(pendingCalls[0].url).toContain('departmentId=justice');
    expect(pendingCalls[0].url).toContain('status=pending');
    expect(pendingCalls[0].url).toContain('limit=100');
    expect(screen.getByText('Backend joignable')).toBeInTheDocument();
  });

  it('keeps À vérifier highlighted on a dossier page', async () => {
    stubConsole({ profile: profile() });
    pathname = '/dossiers/abc';
    renderShell();
    expect(await screen.findByRole('link', { name: 'À vérifier' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows an error with a retry when the profile cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('down'))));
    renderShell();
    expect(await screen.findByText('Impossible de charger votre profil. Réessayez.')).toBeInTheDocument();
    expect(screen.getByText('Backend injoignable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('toggles the mobile menu with aria-expanded', async () => {
    stubConsole({ profile: profile() });
    renderShell();
    const button = screen.getByRole('button', { name: 'Ouvrir le menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('console-nav')).toHaveAttribute('inert');
    await userEvent.setup().click(button);
    expect(screen.getByRole('button', { name: 'Fermer le menu' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('console-nav')).not.toHaveAttribute('inert');
    // Switcher and selector live inside the same panel.
    const panel = document.getElementById('console-nav')!;
    expect(within(panel).getByText('Session de démonstration')).toBeInTheDocument();
    expect(within(panel).getByText('Ministère')).toBeInTheDocument();
  });
});

describe('session switcher and ministry selector', () => {
  it('switches session through the menu, then announces it with the ministry', async () => {
    const { calls } = stubConsole({ profile: profile(), departments: [JUSTICE, ENSEIGNEMENT] });
    renderShell();
    const user = userEvent.setup();
    await screen.findByText('contenu');
    const trigger = screen.getByRole('button', { name: /Agent Justice/ });
    expect(trigger).toHaveTextContent('Agent');
    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Changer de session de démonstration' });
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(3);
    expect(within(menu).getByRole('menuitemradio', { name: /Agent Justice/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(menu).getByRole('menuitemradio', { name: /Super admin/ }));
    expect(calls.find((call) => call.method === 'POST')).toMatchObject({ url: '/api/session', body: { sessionId: 'super' } });
    expect(router.push).toHaveBeenCalledWith('/');
    expect(router.refresh).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('Vous êtes maintenant : Super admin');
  });

  it('shows the ministry as static text for a single-department agent', async () => {
    stubConsole({ profile: profile() });
    renderShell();
    expect(await screen.findByLabelText('Ministère : Justice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Justice' })).toBeNull();
  });

  it('lets a super admin pick a ministry and posts the choice', async () => {
    const { calls } = stubConsole({ profile: SUPER, departments: [JUSTICE, ENSEIGNEMENT] });
    renderShell('super');
    const user = userEvent.setup();
    const trigger = await screen.findByRole('button', { name: 'Justice' });
    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Changer de ministère' });
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Enseignement' }));
    expect(calls.find((call) => call.method === 'POST')).toMatchObject({
      url: '/api/session/department',
      body: { departmentId: 'enseignement' },
    });
    expect(router.push).toHaveBeenCalledWith('/');
    expect(await screen.findByRole('status')).toHaveTextContent('Vous êtes maintenant : Super admin · Enseignement');
    expect(screen.getByRole('button', { name: 'Enseignement' })).toBeInTheDocument();
  });

  it('closes the menu with Escape', async () => {
    stubConsole({ profile: profile() });
    renderShell();
    const user = userEvent.setup();
    await screen.findByText('contenu');
    await user.click(screen.getByRole('button', { name: /Agent Justice/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
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
