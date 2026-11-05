process.env.TZ = 'UTC';

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityLog } from '@/components/admin/work/activity-log';
import { UsersList } from '@/components/admin/work/users-list';
import {
  ADMIN,
  AGENT,
  ANIP,
  CASE_ID,
  JUSTICE,
  OFFICIAL_ID,
  OTHER_OFFICIAL_ID,
  SANTE,
  SUPER,
  consoleStub,
  json,
  official,
  problem,
  resetConsole,
  stubFetch,
  type Call,
} from './helpers/fixtures';

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

describe('Journal (A8)', () => {
  const entry = (overrides = {}) => ({
    id: 'act_01JD0000000000000000000001',
    caseId: CASE_ID,
    caseReference: 'SIM-JUS-2026-000001',
    administrationId: 'justice',
    actor: 'administration',
    officialId: OFFICIAL_ID,
    action: 'case.claimed',
    note: null,
    at: '2026-11-02T09:00:00Z',
    ...overrides,
  });

  it('shows who did what on which case, with French labels and no trace column', async () => {
    const longNote =
      'Pièce d’identité illisible, dossier à redéposer. Merci de fournir un extrait d’acte de naissance plus lisible, puis de confirmer l’identité du demandeur.';
    const { calls } = stubFetch(() =>
      page([
        entry(),
        entry({ id: 'act_01JD0000000000000000000002', actor: 'assistant', officialId: null, action: 'document.issued', note: 'Extrait délivré' }),
        entry({ id: 'act_01JD0000000000000000000003', officialId: OTHER_OFFICIAL_ID, action: 'case.rejected', note: longNote }),
      ]),
    );
    render(<ActivityLog />);
    expect(await screen.findByText('Dossier pris en charge')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Quand',
      'Action',
      'Acteur',
      'Dossier',
      'Note',
    ]);
    expect(screen.getAllByText('2 nov. 2026').length).toBeGreaterThan(0);
    expect(screen.queryByText('hier')).toBeNull();
    expect(screen.getByText('Document délivré')).toBeInTheDocument();
    expect(screen.getByText('Dossier rejeté')).toBeInTheDocument();
    expect(screen.getByText('Agent Justice')).toBeInTheDocument();
    expect(screen.getByText('Assistant')).toBeInTheDocument();
    expect(screen.getByText('Agent 000002')).toBeInTheDocument();
    const dossier = screen.getAllByRole('link', { name: 'SIM-JUS-2026-000001' })[0];
    expect(dossier).toHaveAttribute('href', `/admin/dossiers/${CASE_ID}`);
    expect(dossier).toHaveClass('whitespace-nowrap');
    expect(dossier.closest('td')).toHaveClass('min-w-[14rem]', 'whitespace-nowrap');
    const actor = screen.getByText('Agent Justice');
    expect(actor.closest('td')).toHaveClass('w-[15rem]', 'min-w-[15rem]', 'whitespace-nowrap');
    expect(actor.closest('td')).not.toHaveClass('max-w-[9.5rem]');
    expect(screen.getByText(longNote).closest('td')).toHaveClass('w-[16rem]', 'max-w-[16rem]');
    expect(screen.getByText('Extrait délivré')).toHaveClass('line-clamp-2');
    const note = screen.getByText(longNote);
    expect(note).toHaveClass('line-clamp-2');
    expect(note.textContent).toBe(longNote);
    expect(screen.queryByText('case.claimed')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /Trace|Révision/ })).toBeNull();
    expect(calls[0].url.pathname).toBe('/api/admin/v1/admin/activity');
  });

  it('sorts the loaded rows from a column header, then reverses, without a new request', async () => {
    const { calls } = stubFetch(() =>
      page([
        entry({ id: 'act_01JD0000000000000000000001', action: 'case.claimed' }),
        entry({ id: 'act_01JD0000000000000000000002', action: 'document.issued', note: 'Extrait délivré' }),
        entry({ id: 'act_01JD0000000000000000000003', action: 'case.rejected', note: 'Pièce illisible' }),
      ]),
    );
    render(<ActivityLog />);
    await screen.findByText('Dossier pris en charge');
    const user = userEvent.setup();
    const actionOf = () =>
      screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[1].textContent);
    expect(screen.getByRole('columnheader', { name: 'Action' })).toHaveAttribute('aria-sort', 'none');
    await user.click(screen.getByRole('button', { name: 'Action' }));
    expect(screen.getByRole('columnheader', { name: 'Action' })).toHaveAttribute('aria-sort', 'ascending');
    expect(actionOf()).toEqual(['Document délivré', 'Dossier pris en charge', 'Dossier rejeté']);
    await user.click(screen.getByRole('button', { name: 'Action' }));
    expect(screen.getByRole('columnheader', { name: 'Action' })).toHaveAttribute('aria-sort', 'descending');
    expect(actionOf()).toEqual(['Dossier rejeté', 'Dossier pris en charge', 'Document délivré']);
    expect(calls).toHaveLength(1);
  });
});

describe('Utilisateurs (A9)', () => {
  const agent = official({ displayName: 'Camille Agent', email: 'camille@demo.techma.bj' });
  const boss = official({ id: OTHER_OFFICIAL_ID, displayName: 'Dana Admin', role: 'admin', active: false, email: 'dana@demo.techma.bj' });
  const created = (temporaryPassword = 'Tmp-9xK2-pass') => ({ official: official({ id: 'off_01JD0000000000000000000005', displayName: 'Nouvel Agent' }), temporaryPassword });

  function stubUsers(onPost?: (call: Call) => Response, onPut?: (call: Call) => Response) {
    return stubFetch((call) => {
      if (call.method === 'POST') return onPost ? onPost(call) : json(created(), 201);
      if (call.method === 'PUT') return onPut ? onPut(call) : json(boss);
      return page([agent, boss]);
    });
  }

  it('lists officials read-only with only officials:read', async () => {
    resetConsole(['cases:read', 'officials:read']);
    stubUsers();
    render(<UsersList />);
    expect(await screen.findByText('Camille Agent')).toBeInTheDocument();
    expect(screen.getByText('camille@demo.techma.bj')).toBeInTheDocument();
    expect(screen.getByText('Inactif')).toBeInTheDocument();
    expect(screen.getByText('Administrateur')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ajouter/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Modifier/ })).toBeNull();
  });

  it('shows nothing and fetches nothing without officials:read', () => {
    resetConsole(AGENT);
    const { calls } = stubUsers();
    render(<UsersList />);
    expect(screen.getByText('Vous n’avez pas accès à cette page.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('sorts officials by column and does not make Actions a sort button', async () => {
    resetConsole(ADMIN);
    const { calls } = stubUsers();
    render(<UsersList />);
    await screen.findByText('Camille Agent');
    const user = userEvent.setup();
    const names = () =>
      screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(within(screen.getByRole('columnheader', { name: 'Actions' })).queryByRole('button')).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Nom' })).toHaveAttribute('aria-sort', 'none');
    await user.click(screen.getByRole('button', { name: 'Nom' }));
    expect(names().map((name) => name?.includes('Dana Admin'))).toEqual([false, true]);
    await user.click(screen.getByRole('button', { name: 'Nom' }));
    expect(screen.getByRole('columnheader', { name: 'Nom' })).toHaveAttribute('aria-sort', 'descending');
    expect(names()[0]).toContain('Dana Admin');
    expect(names()[1]).toContain('Camille Agent');
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1);
  });

  it('offers edit but not create to an admin of an administration', async () => {
    resetConsole(ADMIN);
    stubUsers();
    render(<UsersList />);
    await screen.findByText('Camille Agent');
    expect(screen.queryByRole('button', { name: /Ajouter un agent/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Modifier/ })).toHaveLength(2);
  });

  it('offers create and edit to a super admin', async () => {
    resetConsole(SUPER);
    stubUsers();
    render(<UsersList />);
    await screen.findByText('Camille Agent');
    expect(screen.getByRole('button', { name: /Ajouter un agent/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Modifier/ })).toHaveLength(2);
  });

  it('creates an official and shows the temporary password once, with a copy button and a warning', async () => {
    resetConsole(SUPER);
    const { calls } = stubUsers();
    const user = userEvent.setup();
    render(<UsersList />);
    await screen.findByText('Camille Agent');
    await user.click(screen.getByRole('button', { name: /Ajouter un agent/ }));
    await user.type(screen.getByLabelText(/Adresse e-mail/), 'nouvel@demo.techma.bj');
    await user.type(screen.getByLabelText(/Nom affiché/), 'Nouvel Agent');
    await user.type(screen.getByLabelText(/Fonction/), 'Instructeur');
    await user.click(screen.getByRole('button', { name: 'Créer le compte' }));

    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url.pathname).toBe('/api/admin/v1/admin/officials');
    expect(post.body).toEqual({
      email: 'nouvel@demo.techma.bj',
      displayName: 'Nouvel Agent',
      jobTitle: 'Instructeur',
      administrationId: 'justice',
      role: 'agent',
    });

    const dialog = await screen.findByRole('dialog', { name: 'Compte créé' });
    expect(within(dialog).getByLabelText('Mot de passe temporaire')).toHaveTextContent('Tmp-9xK2-pass');
    expect(within(dialog).getByText(/ne sera plus affiché/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Copier' }));
    expect(await navigator.clipboard.readText()).toBe('Tmp-9xK2-pass');
    expect(await within(dialog).findByRole('button', { name: 'Copié' })).toBeInTheDocument();

    // Escape does not drop it by accident; only the explicit button does, and then it is gone for good.
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Compte créé' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'J’ai copié le mot de passe' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.textContent).not.toContain('Tmp-9xK2-pass');
    // The list was reloaded after the creation.
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThanOrEqual(2));
  });

  it('never logs the temporary password', async () => {
    resetConsole(SUPER);
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    stubUsers();
    const user = userEvent.setup();
    render(<UsersList />);
    await screen.findByText('Camille Agent');
    await user.click(screen.getByRole('button', { name: /Ajouter un agent/ }));
    await user.type(screen.getByLabelText(/Adresse e-mail/), 'a@b.bj');
    await user.type(screen.getByLabelText(/Nom affiché/), 'A');
    await user.type(screen.getByLabelText(/Fonction/), 'B');
    await user.click(screen.getByRole('button', { name: 'Créer le compte' }));
    await screen.findByRole('dialog', { name: 'Compte créé' });
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain('Tmp-9xK2-pass');
    vi.restoreAllMocks();
  });

  it('shows a creation problem (409 e-mail already used) and keeps the form open', async () => {
    resetConsole(SUPER);
    stubUsers(() => problem(409, 'CONFLICT', 'Cette adresse est déjà utilisée.'));
    const user = userEvent.setup();
    render(<UsersList />);
    await screen.findByText('Camille Agent');
    await user.click(screen.getByRole('button', { name: /Ajouter un agent/ }));
    await user.type(screen.getByLabelText(/Adresse e-mail/), 'a@b.bj');
    await user.type(screen.getByLabelText(/Nom affiché/), 'A');
    await user.type(screen.getByLabelText(/Fonction/), 'B');
    await user.click(screen.getByRole('button', { name: 'Créer le compte' }));
    expect(await screen.findByText('Cette adresse est déjà utilisée.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Ajouter un agent' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Compte créé' })).toBeNull();
  });

  it('limits the roles to agent and admin for an admin of an administration, and keeps their administration', async () => {
    resetConsole(ADMIN);
    stubUsers();
    const user = userEvent.setup();
    render(<UsersList />);
    await screen.findByText('Camille Agent');
    await user.click(screen.getByRole('button', { name: /Modifier Camille Agent/ }));
    const dialog = screen.getByRole('dialog', { name: 'Modifier Camille Agent' });
    const roles = within(dialog).getByLabelText('Rôle');
    expect(within(roles).getAllByRole('option').map((o) => o.textContent)).toEqual(['Agent', 'Administrateur']);
    expect(within(dialog).queryByLabelText('Administration')).toBeNull();
  });

  it('lets a super admin choose a connected administration and the super_admin role (administrationId null)', async () => {
    resetConsole(SUPER, { administrations: [JUSTICE, ANIP, SANTE], scopeId: 'justice' });
    const { calls } = stubUsers();
    const user = userEvent.setup();
    render(<UsersList />);
    await screen.findByText('Camille Agent');
    await user.click(screen.getByRole('button', { name: /Ajouter un agent/ }));
    const administrations = within(screen.getByLabelText('Administration')).getAllByRole('option') as HTMLOptionElement[];
    expect(administrations.map((option) => option.textContent)).toEqual(['Choisir une administration', 'Ministère de la Justice', 'ANIP']);
    expect(administrations.find((o) => o.textContent?.includes('Santé'))).toBeUndefined();
    await user.type(screen.getByLabelText(/Adresse e-mail/), 'a@b.bj');
    await user.type(screen.getByLabelText(/Nom affiché/), 'A');
    await user.type(screen.getByLabelText(/Fonction/), 'B');
    await user.selectOptions(screen.getByLabelText('Rôle'), 'super_admin');
    expect(screen.queryByLabelText('Administration')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Créer le compte' }));
    await screen.findByRole('dialog', { name: 'Compte créé' });
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ role: 'super_admin', administrationId: null });
  });

  it('edits administration, role and active with PUT', async () => {
    resetConsole(ADMIN);
    const { calls } = stubUsers();
    const user = userEvent.setup();
    render(<UsersList />);
    await screen.findByText('Camille Agent');
    await user.click(screen.getByRole('button', { name: /Modifier Dana Admin/ }));
    const dialog = screen.getByRole('dialog', { name: 'Modifier Dana Admin' });
    await user.selectOptions(within(dialog).getByLabelText('Rôle'), 'agent');
    await user.click(within(dialog).getByRole('switch', { name: 'Compte actif' }));
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await screen.findByText('Modifications enregistrées.');
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url.pathname).toBe(`/api/admin/v1/admin/officials/${OTHER_OFFICIAL_ID}`);
    expect(put.body).toEqual({ administrationId: 'justice', role: 'agent', active: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('scopes the list to the chosen administration for a super admin', async () => {
    resetConsole(SUPER, { scopeId: 'anip' });
    const { calls } = stubUsers();
    render(<UsersList />);
    await screen.findByText('Camille Agent');
    expect(calls[0].url.searchParams.get('administrationId')).toBe('anip');
    void consoleStub;
  });
});
