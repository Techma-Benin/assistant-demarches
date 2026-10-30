process.env.TZ = 'UTC';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkItemDetail } from '@/components/work/work-detail';
import type { AdminWorkItem } from '@/lib/department-api';
import { json, problem } from './helpers/c3-fetch';
import { item, resetConsole, stubFetch } from './helpers/work';

vi.mock('@/components/console/console-context', async () => {
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

const ID = 'req_00000000000000000000000001';
const labels = () => screen.getAllByRole('button').map((b) => b.textContent);

async function open(overrides: Partial<AdminWorkItem>, onAction?: Parameters<typeof stubFetch>[0]) {
  const stub = stubFetch((call) => {
    if (call.method === 'POST') return onAction ? onAction(call) : json(item(overrides));
    return json(item(overrides));
  });
  render(<WorkItemDetail id={ID} />);
  await screen.findByRole('heading', { level: 1, name: 'Casier judiciaire — simulation' });
  return stub;
}

describe('Dossier detail', () => {
  it('shows progress, payment, fields with evidence, documents and the simulation note', async () => {
    await open({
      status: 'processing',
      fields: { nom_complet: 'Awa Dossou', dateNaissance: '1990-01-01' },
      evidence: [{ field: 'nom_complet', source: 'document', confirmed: true }],
      progress: { step: 2, total: 4, label: 'Vérification' },
      payment: { status: 'paid', amountFcfa: 2000, currency: 'XOF' } as AdminWorkItem['payment'],
      fileIds: ['fil_1', 'fil_2'],
      documents: [
        {
          fileId: 'fil_9',
          name: 'Extrait.pdf',
          mimeType: 'application/pdf',
          createdAt: '2026-10-30T10:00:00Z',
          expiresAt: '2026-11-30T10:00:00Z',
          simulation: true,
        },
      ],
    });
    expect(screen.getByText('Dossier simulé : aucune démarche réelle')).toBeInTheDocument();
    expect(screen.getByText('Étape 2 sur 4 · Vérification')).toBeInTheDocument();
    expect(screen.getByText('Nom complet')).toBeInTheDocument();
    expect(screen.getByText('Awa Dossou')).toBeInTheDocument();
    expect(screen.getByText('Date naissance')).toBeInTheDocument();
    expect(screen.getByText(/Source : lu dans un document · confirmé/)).toBeInTheDocument();
    expect(screen.getByText('2 pièces conservées par référence')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Extrait.pdf' })).toHaveAttribute(
      'href',
      '/api/admin/v1/admin/work-items/req_00000000000000000000000001/documents/fil_9',
    );
    expect(screen.getByText('Paiement', { selector: 'dt' })).toBeInTheDocument();
  });

  it('offers only « Prendre en charge » when submitted', async () => {
    await open({ status: 'submitted' });
    expect(labels()).toEqual(['Prendre en charge']);
  });

  it('offers request information, validate and reject when processing', async () => {
    await open({ status: 'processing' });
    expect(labels()).toEqual(['Demander une information', 'Valider', 'Rejeter']);
  });

  it('offers only « Reprendre » when blocked and shows the blocking reason', async () => {
    await open({ status: 'blocked', blocking: { code: 'PAYMENT', detail: 'Paiement échoué', at: '2026-10-30T09:40:00Z' } });
    expect(labels()).toEqual(['Reprendre']);
    expect(screen.getByText('Paiement échoué')).toBeInTheDocument();
  });

  it('offers no action when completed', async () => {
    await open({ status: 'completed' });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('claim POSTs { action, revision } with an Idempotency-Key, then replaces the item and toasts', async () => {
    const { calls } = await open({ status: 'submitted' }, () =>
      json(item({ status: 'processing', revision: 4, assignedTo: 'Awa' })),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Prendre en charge' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Dossier pris en charge.');
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url.pathname).toBe(`/api/admin/v1/admin/work-items/${ID}/actions`);
    expect(post.body).toEqual({ action: 'claim', revision: 3 });
    expect(post.headers['idempotency-key']).toMatch(/.{8,}/);
    expect(post.headers.traceparent).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Valider' })).toBeInTheDocument();
  });

  it('reject requires a reason before it can be confirmed', async () => {
    const { calls } = await open({ status: 'processing' }, () => json(item({ status: 'rejected' })));
    await userEvent.click(screen.getByRole('button', { name: 'Rejeter' }));
    const confirm = screen.getByRole('button', { name: 'Confirmer le rejet' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Motif du rejet/), 'Pièce illisible');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(await screen.findByRole('status')).toHaveTextContent('Dossier rejeté.');
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      action: 'reject',
      revision: 3,
      reason: 'Pièce illisible',
    });
  });

  it('request information sends the reason', async () => {
    const { calls } = await open({ status: 'processing' });
    await userEvent.click(screen.getByRole('button', { name: 'Demander une information' }));
    await userEvent.type(screen.getByLabelText(/Information demandée/), 'Merci de renvoyer la pièce');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer la demande' }));
    await screen.findByRole('status');
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      action: 'request_information',
      reason: 'Merci de renvoyer la pièce',
    });
  });

  it('approve is a direct action', async () => {
    const { calls } = await open({ status: 'processing' }, () => json(item({ status: 'completed' })));
    await userEvent.click(screen.getByRole('button', { name: 'Valider' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Dossier validé.');
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ action: 'approve', revision: 3 });
  });

  it('shows « Le dossier a changé entre-temps » on 409 and reloads the item', async () => {
    const { calls } = await open({ status: 'submitted' }, () => problem(409, 'INVALID_TRANSITION', 'stale'));
    await userEvent.click(screen.getByRole('button', { name: 'Prendre en charge' }));
    expect(await screen.findByText('Le dossier a changé entre-temps')).toBeInTheDocument();
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2));
  });

  it('shows an error when the dossier cannot be loaded', async () => {
    stubFetch(() => new Response('x', { status: 500 }));
    render(<WorkItemDetail id={ID} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
