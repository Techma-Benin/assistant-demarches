process.env.TZ = 'UTC';

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkItemDetail } from '@/components/admin/work/work-detail';
import type { Case } from '@/lib/admin/api';
import {
  CASE_ID,
  DOC_ID,
  OFFICIAL_ID,
  OTHER_OFFICIAL_ID,
  caseItem,
  json,
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

const TITLE = 'Délivrance du Casier judiciaire (Extrait B3 du casier judiciaire)';
const buttons = () => screen.queryAllByRole('button').map((b) => b.textContent);
const entry = (action: string, overrides = {}) => ({
  id: 'act_01JD0000000000000000000001',
  caseId: CASE_ID,
  caseReference: 'SIM-JUS-2026-000001',
  administrationId: 'justice',
  actor: 'assistant',
  officialId: null,
  action,
  note: null,
  at: '2026-11-02T09:05:00Z',
  ...overrides,
});

async function open(
  overrides: Partial<Case>,
  onAction?: (call: Call) => Response | Promise<Response>,
  activity: unknown[] = [],
) {
  const stub = stubFetch((call) => {
    if (call.method === 'POST') return onAction ? onAction(call) : json(caseItem(overrides));
    if (call.url.pathname.endsWith('/activity')) return json({ items: activity, nextCursor: null });
    return json(caseItem(overrides));
  });
  render(<WorkItemDetail id={CASE_ID} />);
  await screen.findByRole('heading', { level: 1, name: TITLE });
  return stub;
}

describe('case detail (A4)', () => {
  it('shows the status, the reference with the Simulation mark, fields, payment and procedure', async () => {
    await open({ status: 'in_review' });
    expect(screen.getByText('En vérification')).toBeInTheDocument();
    expect(screen.getByText('SIM-JUS-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('Simulation')).toBeInTheDocument();
    expect(screen.getByText('Dossier simulé : aucune démarche réelle')).toBeInTheDocument();
    expect(screen.getByText('PS00373')).toBeInTheDocument();
    expect(screen.getByText('Payé · 1 900 FCFA')).toBeInTheDocument();
    expect(screen.getByText('SIM-PAY-000001')).toBeInTheDocument();
    const infos = screen.getByRole('region', { name: 'Informations du dossier' });
    expect(within(infos).getByText('Adresse domicile')).toBeInTheDocument();
    expect(within(infos).getByText('Cotonou, Akpakpa')).toBeInTheDocument();
    expect(within(infos).getByText('2')).toBeInTheDocument();
  });

  it('shows the steps: what the assistant did and what needs an intervention', async () => {
    await open({});
    const steps = screen.getByRole('region', { name: 'Étapes' });
    const items = within(steps).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Dossier déposé par l’assistant');
    expect(items[0]).toHaveTextContent('Fait');
    expect(items[0]).toHaveTextContent('Assistant');
    expect(items[2]).toHaveTextContent('Vérification de l’identité par un agent');
    expect(items[2]).toHaveTextContent('Intervention requise');
    expect(items[2]).toHaveTextContent('Nouvelle demande à vérifier');
  });

  it('separates submitted documents from issued ones, each downloadable', async () => {
    await open({
      status: 'completed',
      completedBy: 'administration',
      documents: [
        caseItem().documents[0],
        {
          id: 'doc_01JD0000000000000000000002',
          kind: 'issued',
          documentType: 'casier-judiciaire',
          name: 'Extrait B3 SIMULATION',
          mimeType: 'application/pdf',
          sizeBytes: 90000,
          createdAt: '2026-11-03T10:00:00Z',
        },
      ],
    });
    const submitted = screen.getByRole('region', { name: 'Pièces de l’usager' });
    expect(within(submitted).getByRole('link', { name: 'Extrait d’acte de naissance' })).toHaveAttribute(
      'href',
      `/api/admin/v1/admin/cases/${CASE_ID}/documents/${DOC_ID}`,
    );
    const issued = screen.getByRole('region', { name: 'Documents délivrés' });
    expect(within(issued).getByRole('link', { name: 'Extrait B3 SIMULATION' })).toHaveAttribute(
      'href',
      `/api/admin/v1/admin/cases/${CASE_ID}/documents/doc_01JD0000000000000000000002`,
    );
    expect(within(issued).queryByText('Extrait d’acte de naissance')).toBeNull();
  });

  it('omits the sections without documents', async () => {
    await open({ documents: [] });
    expect(screen.queryByRole('region', { name: 'Pièces de l’usager' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Documents délivrés' })).toBeNull();
  });

  it('shows claimedBy by name (officials:read), the information request and who completed', async () => {
    await open({
      status: 'information_requested',
      claimedBy: OFFICIAL_ID,
      informationRequest: { note: 'Merci de joindre une pièce lisible', requestedAt: '2026-11-03T08:00:00Z', requestedBy: OTHER_OFFICIAL_ID },
    });
    expect(screen.getByText('Pris en charge par').nextElementSibling).toHaveTextContent('Agent Justice');
    const request = screen.getByRole('region', { name: 'Complément demandé' });
    expect(request).toHaveTextContent('Merci de joindre une pièce lisible');
    expect(request).toHaveTextContent('Agent 000002');
  });

  it.each([
    ['assistant', 'par l’assistant'],
    ['administration', 'par l’administration'],
  ] as const)('labels completion by %s', async (completedBy, label) => {
    await open({ status: 'completed', completedBy });
    expect(screen.getByText('Complété', { selector: 'dt' }).nextElementSibling).toHaveTextContent(label);
  });

  it('shows the decision note of a rejected case', async () => {
    await open({ status: 'rejected', decisionNote: 'Pièce d’identité illisible' });
    const note = screen.getByRole('region', { name: 'Décision' });
    expect(note).toHaveTextContent('Motif du rejet');
    expect(note).toHaveTextContent('Pièce d’identité illisible');
    expect(screen.getByRole('link', { name: /Retour aux dossiers rejeté/ })).toHaveAttribute('href', '/admin/rejete');
  });

  it('loads the case journal for this case and the case’s administration, with French labels', async () => {
    const { calls } = await open({}, undefined, [
      entry('case.created'),
      entry('case.claimed', { actor: 'administration', officialId: OFFICIAL_ID, at: '2026-11-02T10:00:00Z' }),
    ]);
    const history = await screen.findByRole('region', { name: 'Historique du dossier' });
    await within(history).findByText('Dossier pris en charge');
    expect(within(history).getByText('Dossier créé')).toBeInTheDocument();
    expect(within(history).getByText('Agent Justice')).toBeInTheDocument();
    const activity = calls.find((c) => c.url.pathname.endsWith('/activity'))!;
    expect(activity.url.searchParams.get('caseId')).toBe(CASE_ID);
    expect(activity.url.searchParams.get('administrationId')).toBe('justice');
  });

  it('has no trace of conversation text', async () => {
    await open({});
    expect(screen.queryByText(/conversation|message/i)).toBeNull();
  });

  it('shows an error with a retry when the case cannot be loaded', async () => {
    stubFetch(() => problem(404, 'NOT_FOUND', 'Dossier introuvable'));
    render(<WorkItemDetail id={CASE_ID} />);
    expect(await screen.findByText('Impossible de charger le dossier.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});

describe('action visibility by status (A5)', () => {
  it.each([
    ['awaiting_payment', []],
    ['received', ['Prendre en charge']],
    ['in_review', ['Prendre en charge', 'Demander un complément', 'Approuver', 'Rejeter']],
    ['information_requested', ['Rejeter']],
    ['completed', []],
    ['rejected', []],
  ] as const)('%s offers %j', async (status, expected) => {
    await open({ status });
    expect(buttons().filter((label) => label !== 'Réessayer')).toEqual([...expected]);
  });

  it('hides every action without cases:act', async () => {
    resetConsole(['cases:read']);
    await open({ status: 'in_review' });
    expect(screen.queryByRole('region', { name: 'Actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approuver' })).toBeNull();
  });

  it('shows nothing at all without cases:read', () => {
    resetConsole(['officials:read']);
    const { calls } = stubFetch(() => json(caseItem()));
    render(<WorkItemDetail id={CASE_ID} />);
    expect(screen.getByText('Vous n’avez pas accès à cette page.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

describe('actions (A5)', () => {
  const actionCalls = (calls: Call[]) => calls.filter((c) => c.method === 'POST');

  it('claims with { action, note: null } and an Idempotency-Key, then refreshes the case', async () => {
    const { calls } = await open({ status: 'received' }, () =>
      json(caseItem({ status: 'in_review', claimedBy: OFFICIAL_ID })),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Prendre en charge' }));
    expect(await screen.findByText('Dossier pris en charge.')).toBeInTheDocument();
    const [call] = actionCalls(calls);
    expect(call.url.pathname).toBe(`/api/admin/v1/admin/cases/${CASE_ID}/actions`);
    expect(call.body).toEqual({ action: 'claim', note: null });
    expect(Object.keys(call.body)).toEqual(['action', 'note']);
    expect(call.headers['idempotency-key']).toMatch(/^act-cas_[0-9A-Z]{26}-/);
    expect(call.headers['idempotency-key'].length).toBeGreaterThanOrEqual(8);
    expect(call.headers['idempotency-key'].length).toBeLessThanOrEqual(128);
    // The returned case replaces the displayed one: status and buttons follow.
    expect(await screen.findByText('En vérification')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approuver' })).toBeInTheDocument();
  });

  it('approves with note null', async () => {
    const { calls } = await open({ status: 'in_review' }, () => json(caseItem({ status: 'completed', completedBy: 'administration' })));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Approuver' }));
    expect(await screen.findByText('Dossier approuvé.')).toBeInTheDocument();
    expect(actionCalls(calls)[0].body).toEqual({ action: 'approve', note: null });
    expect(screen.queryByRole('button', { name: 'Approuver' })).toBeNull();
  });

  it.each([
    ['Demander un complément', 'request_information', 'Complément demandé à l’usager', 'Envoyer la demande', 'Demande de complément envoyée.'],
    ['Rejeter', 'reject', 'Motif du rejet', 'Confirmer le rejet', 'Dossier rejeté.'],
  ])('%s requires a non-empty note and sends it', async (button, action, label, confirm, success) => {
    const { calls } = await open({ status: 'in_review' }, () => json(caseItem({ status: 'rejected' })));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: button }));
    expect(actionCalls(calls)).toHaveLength(0); // the note comes first
    const submit = screen.getByRole('button', { name: confirm });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(new RegExp(label)), '   ');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(new RegExp(label)), ' Pièce illisible ');
    await user.click(submit);
    expect(await screen.findByText(success)).toBeInTheDocument();
    expect(actionCalls(calls)[0].body).toEqual({ action, note: 'Pièce illisible' });
  });

  it('shows the server problem for 409 INVALID_TRANSITION and reloads the case', async () => {
    const { calls } = await open({ status: 'in_review' }, () =>
      problem(409, 'INVALID_TRANSITION', 'Le dossier est déjà complété.'),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Approuver' }));
    expect(await screen.findByText('Le dossier est déjà complété.')).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && !c.url.pathname.endsWith('/activity'))).toHaveLength(2));
    expect(screen.getByText('Le dossier est déjà complété.')).toBeInTheDocument();
  });

  it('shows other problems as messages (403, 400)', async () => {
    const user = userEvent.setup();
    await open({ status: 'in_review' }, () => problem(403, 'FORBIDDEN', 'refusé'));
    await user.click(screen.getByRole('button', { name: 'Approuver' }));
    expect(await screen.findByText('Vous n’avez pas le droit d’effectuer cette action.')).toBeInTheDocument();
  });

  it('reuses the Idempotency-Key when the same intent is retried after a 503, and changes it for a new intent', async () => {
    let attempt = 0;
    const { calls } = await open({ status: 'in_review' }, () => {
      attempt += 1;
      return attempt === 1 ? problem(503, 'UPSTREAM_UNAVAILABLE', 'indisponible') : json(caseItem({ status: 'in_review' }));
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Prendre en charge' }));
    expect(await screen.findByText('Service indisponible. Réessayez.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Prendre en charge' }));
    await screen.findByText('Dossier pris en charge.');
    const keys = actionCalls(calls).map((c) => c.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    await user.click(screen.getByRole('button', { name: 'Prendre en charge' }));
    await waitFor(() => expect(actionCalls(calls)).toHaveLength(3));
    expect(actionCalls(calls)[2].headers['idempotency-key']).not.toBe(keys[0]);
  });

  it('does not require having claimed the case first: approve is offered on an unclaimed in_review case', async () => {
    await open({ status: 'in_review', claimedBy: null });
    expect(screen.getByRole('button', { name: 'Approuver' })).toBeEnabled();
  });
});
