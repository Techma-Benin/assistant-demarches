import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcedureEdit } from '@/components/procedure-edit';
import { RequireCapability } from '@/components/session/require-capability';
import { AppShell } from '@/components/shell/app-shell';
import { IdentitySwitcher } from '@/components/shell/identity-switcher';
import { ToolsTable } from '@/components/tools-table';
import { json, problem, stubC3 } from './helpers/c3-fetch';
import { adminRead, adminWrite, platform, render, sessionOf } from './helpers/session';

const push = vi.fn();
const refresh = vi.fn();
let pathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push, refresh }),
}));

beforeEach(() => {
  pathname = '/';
  push.mockClear();
  refresh.mockClear();
  stubC3({ lists: {} });
});
afterEach(() => vi.unstubAllGlobals());

const multi = sessionOf(adminWrite, [platform, adminRead]);

function stubSwitch(response: () => Response) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/session/identity') {
        calls.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
        return response();
      }
      return json({ items: [], nextCursor: null });
    }),
  );
  return calls;
}

describe('IdentitySwitcher', () => {
  it('shows the active identity and its access, and names the person at the top of the menu', async () => {
    render(<IdentitySwitcher />, { session: multi });
    const trigger = screen.getByRole('button', { name: /Ministère de la Justice/ });
    expect(trigger).toHaveTextContent('Écriture');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(trigger);
    expect(screen.getByText('Aïcha D.')).toBeInTheDocument();
  });

  it('opens a menu of radios with the active identity checked', async () => {
    render(<IdentitySwitcher />, { session: multi });
    await userEvent.setup().click(screen.getByRole('button', { name: /Ministère de la Justice/ }));
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items).toHaveLength(3);
    expect(within(menu).getByRole('menuitemradio', { name: /Ministère de la Justice/ })).toBeChecked();
    expect(within(menu).getByRole('menuitemradio', { name: /Mairie de Cotonou/ })).not.toBeChecked();
    expect(within(menu).getByRole('menuitemradio', { name: /Mairie de Cotonou/ })).toHaveTextContent('Lecture seule');
    expect(within(menu).getByRole('menuitemradio', { name: /Équipe Techma/ })).toHaveTextContent('Plateforme');
    // Focus lands on the checked item.
    expect(items[0]).toHaveFocus();
  });

  it('moves with the arrow keys and closes on Escape, returning focus', async () => {
    render(<IdentitySwitcher />, { session: multi });
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: /Ministère de la Justice/ });
    await user.click(trigger);
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: /Équipe Techma/ })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('menuitemradio', { name: /Mairie de Cotonou/ })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes on a click outside', async () => {
    render(
      <>
        <IdentitySwitcher />
        <p>ailleurs</p>
      </>,
      { session: multi },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Ministère de la Justice/ }));
    await user.click(screen.getByText('ailleurs'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('POSTs the chosen identity, then navigates home, refreshes and announces it', async () => {
    const calls = stubSwitch(() => json(sessionOf(platform, [adminWrite, adminRead])));
    render(<IdentitySwitcher />, { session: multi });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Ministère de la Justice/ }));
    await user.click(screen.getByRole('menuitemradio', { name: /Équipe Techma/ }));
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ identityId: 'idt_platform' });
    expect(calls[0].headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(await screen.findByText('Vous agissez maintenant en tant que : Équipe Techma')).toBeInTheDocument();
    expect(push).toHaveBeenCalledWith('/');
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Équipe Techma/ })).toHaveTextContent('Plateforme');
  });

  it('shows the server detail when the switch fails, and keeps the identity', async () => {
    stubSwitch(() => problem(403, 'FORBIDDEN', 'Identité non autorisée'));
    render(<IdentitySwitcher />, { session: multi });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Ministère de la Justice/ }));
    await user.click(screen.getByRole('menuitemradio', { name: /Mairie de Cotonou/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Identité non autorisée');
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: /Ministère de la Justice/ })).toBeEnabled());
  });

  it('has no menu with a single identity', () => {
    render(<IdentitySwitcher />, { session: sessionOf(platform) });
    expect(screen.getByText('Équipe Techma')).toBeInTheDocument();
    expect(screen.getByText('Plateforme')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Équipe Techma/ })).toBeNull();
  });
});

describe('AppShell and identities', () => {
  it('shows every module to the platform', () => {
    render(<AppShell>x</AppShell>, { session: sessionOf(platform) });
    expect(screen.getByRole('link', { name: 'Connexions MCP' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Modèle IA' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Journal d’audit' })).toBeInTheDocument();
  });

  it('hides platform modules and service lines from an administration in read access', () => {
    render(<AppShell>x</AppShell>, { session: sessionOf(adminRead) });
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Vue d’ensemble',
      'Fiches',
      'Conversations',
    ]);
    expect(screen.queryByText(/connexion.* MCP/)).toBeNull();
    expect(screen.queryByText(/Modèle :/)).toBeNull();
    expect(screen.getByText(/Backend/)).toBeInTheDocument();
  });

  it('shows a calm message when there is no session', () => {
    render(<AppShell>contenu</AppShell>, { session: null });
    expect(screen.getByRole('heading', { name: 'Session administrateur indisponible' })).toBeInTheDocument();
    expect(screen.queryByText('contenu')).toBeNull();
  });

  it('only counts the fiches of the administration in the Fiches badge', async () => {
    stubC3({
      lists: {
        procedures: [[
          { id: 'a', administrationId: 'justice', validationStatus: 'draft' },
          { id: 'b', administrationId: 'mairie-cotonou', validationStatus: 'draft' },
          { id: 'c', administrationId: 'mairie-cotonou', validationStatus: 'draft' },
        ]],
      },
    });
    render(<AppShell>x</AppShell>, { session: sessionOf(adminWrite) });
    expect(await screen.findByRole('link', { name: 'Fiches, 1 à traiter' })).toBeInTheDocument();
  });
});

describe('RequireCapability', () => {
  it('renders the children when allowed', () => {
    render(
      <RequireCapability capability="tools.view">
        <p>contenu protégé</p>
      </RequireCapability>,
      { session: sessionOf(platform) },
    );
    expect(screen.getByText('contenu protégé')).toBeInTheDocument();
  });

  it('shows the no-access screen with a shortcut to an identity that has the capability', async () => {
    const calls = stubSwitch(() => json(sessionOf(platform, [adminRead])));
    render(
      <RequireCapability capability="tools.view">
        <p>contenu protégé</p>
      </RequireCapability>,
      { session: sessionOf(adminRead, [platform]) },
    );
    expect(screen.queryByText('contenu protégé')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Pas d’accès avec cette identité' })).toBeInTheDocument();
    expect(screen.getByText(/Mairie de Cotonou/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Passer à Équipe Techma' }));
    expect(calls[0].body).toEqual({ identityId: 'idt_platform' });
  });

  it('says so when no identity of the session has access', () => {
    render(
      <RequireCapability capability="audit.view">
        <p>contenu protégé</p>
      </RequireCapability>,
      { session: sessionOf(adminRead, [adminWrite]) },
    );
    expect(screen.getByText('Aucune de vos identités n’y a accès.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Passer à/ })).toBeNull();
  });
});

const procedure = {
  id: 'passeport',
  title: 'Passeport',
  administrationId: 'dgdi',
  summary: 'Demande de passeport.',
  requiredDocuments: ['Photo'],
  feeFcfa: 25000,
  processingDays: 15,
  source: { procedureId: 'passeport', url: 'https://example.org/p', retrievedAt: '2026-03-05T10:30:00.000Z', version: '2026-03' },
  validationStatus: 'draft',
  formSchema: { type: 'object', properties: {} },
};

describe('Fiche editor and identities', () => {
  const dgdiRead = { ...adminRead, administrationId: 'dgdi' };
  const dgdiWrite = { ...adminWrite, administrationId: 'dgdi' };

  it('is read-only for an administration in read access', async () => {
    stubC3({ lists: { procedures: [[procedure]] } });
    render(<ProcedureEdit id="passeport" />, { session: sessionOf(dgdiRead) });
    await screen.findByRole('button', { name: 'Enregistrer' });
    expect(screen.getByText('Vous agissez en tant que : Mairie de Cotonou')).toBeInTheDocument();
    expect(screen.getByText('Lecture seule avec l’identité Mairie de Cotonou.')).toBeInTheDocument();
    for (const name of ['Enregistrer', 'Valider et publier', 'Retirer Photo', 'Ajouter une pièce']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByLabelText(/Titre/)).toHaveAttribute('readonly');
  });

  it('is editable for an administration in write access', async () => {
    stubC3({ lists: { procedures: [[procedure]] } });
    render(<ProcedureEdit id="passeport" />, { session: sessionOf(dgdiWrite) });
    await screen.findByRole('button', { name: 'Enregistrer' });
    expect(screen.queryByText(/Lecture seule avec/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Valider et publier' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Retirer Photo' })).toBeEnabled();
    expect(screen.getByLabelText(/Titre/)).not.toHaveAttribute('readonly');
  });

  it('shows the no-access screen for a fiche of another administration', async () => {
    stubC3({ lists: { procedures: [[procedure]] } });
    render(<ProcedureEdit id="passeport" />, { session: sessionOf(adminWrite, [platform]) });
    expect(await screen.findByRole('heading', { name: 'Pas d’accès avec cette identité' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Passer à Équipe Techma' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Titre/)).toBeNull();
  });
});

describe('Connexions MCP and identities', () => {
  it('disables the switches without tools.edit', async () => {
    stubC3({ lists: { tools: [[{ name: 'search', enabled: true, serverUrl: 'https://a.example' }]] } });
    render(<ToolsTable />, { session: sessionOf({ ...platform, access: 'read' }) });
    expect(await screen.findByRole('switch', { name: 'Activer search' })).toBeDisabled();
    expect(screen.getByText('Lecture seule avec l’identité Équipe Techma.')).toBeInTheDocument();
  });
});
