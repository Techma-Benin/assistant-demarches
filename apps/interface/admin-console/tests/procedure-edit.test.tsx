import { screen, waitFor, within } from '@testing-library/react';
import { render } from './helpers/session';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProcedureEdit } from '@/components/procedure-edit';
import { isoToLocalInput, localInputToIso } from '@/lib/procedure-form';
import { json, problem, stubC3 } from './helpers/c3-fetch';

const procedure = {
  id: 'passeport',
  title: 'Passeport',
  administrationId: 'dgdi',
  summary: 'Demande de passeport.',
  requiredDocuments: ['Photo', 'Acte de naissance'],
  feeFcfa: 25000,
  processingDays: 15,
  source: {
    procedureId: 'passeport',
    url: 'https://example.org/passeport',
    retrievedAt: '2026-03-05T10:30:45.123Z',
    version: '2026-03',
  },
  validationStatus: 'draft',
  formSchema: { type: 'object', properties: { nom: { type: 'string' }, age: { type: 'integer' } }, required: ['nom'] },
};

beforeAll(() => {
  process.env.TZ = 'UTC';
});
afterEach(() => vi.unstubAllGlobals());

async function setup(options: Partial<Parameters<typeof stubC3>[0]> = {}) {
  const stub = stubC3({ lists: { procedures: [[procedure]] }, ...options });
  render(<ProcedureEdit id="passeport" />);
  await screen.findByRole('button', { name: 'Enregistrer' });
  return { ...stub, user: userEvent.setup() };
}

const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Enregistrer' }));

describe('ProcedureEdit', () => {
  it('renders the fields, the read-only identifiers and the user preview', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Passeport' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Source officielle' })).toBeInTheDocument();
    expect(screen.getByText(/dgdi/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Résumé lu par l’assistant/)).toHaveValue('Demande de passeport.');
    expect(screen.getByLabelText(/Frais \(FCFA\)/)).toHaveValue(25000);
    expect(screen.getByLabelText(/Délai de traitement \(jours\)/)).toHaveValue(15);
    expect(screen.getByLabelText(/URL de la fiche/)).toHaveValue('https://example.org/passeport');
    expect(screen.getByRole('link', { name: /Retour aux fiches/ })).toHaveAttribute('href', '/procedures');
    expect(screen.getByRole('heading', { level: 2, name: 'Aperçu côté usager' })).toBeInTheDocument();
    expect(screen.getByText('Non citée tant qu’en brouillon')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Pièces à fournir (aperçu)' })).toHaveTextContent('Acte de naissance');
  });

  it('warns when the source is older than 90 days, and not when it is recent', async () => {
    stubC3({ lists: { procedures: [[procedure]] } });
    const { unmount } = render(<ProcedureEdit id="passeport" now={new Date('2026-09-01T00:00:00Z')} />);
    expect(await screen.findByText(/Source consultée il y a plus de 90 jours/)).toBeInTheDocument();
    unmount();
    render(<ProcedureEdit id="passeport" now={new Date('2026-03-20T00:00:00Z')} />);
    await screen.findByRole('button', { name: 'Enregistrer' });
    expect(screen.queryByText(/Source consultée il y a plus de 90 jours/)).toBeNull();
  });

  it('blocks save on invalid fields', async () => {
    const { user } = await setup();
    await user.clear(screen.getByLabelText(/Titre/));
    expect(screen.getByLabelText(/Titre/)).toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByLabelText(/Titre/), 'Passeport');
    const fee = screen.getByLabelText(/Frais \(FCFA\)/);
    await user.clear(fee);
    await user.type(fee, '1.5');
    expect(fee).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
    await user.clear(fee);
    await user.type(fee, '100');
    const url = screen.getByLabelText(/URL de la fiche/);
    await user.clear(url);
    await user.type(url, 'ftp://example.org');
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
    await user.clear(url);
    await user.type(url, 'http://example.org');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
  });

  it('adds and removes required documents without empties or duplicates', async () => {
    const { user, puts } = await setup();
    expect(screen.queryByLabelText('Nom de la pièce')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ajouter une pièce' }));
    const add = screen.getByRole('button', { name: 'Ajouter' });
    expect(add).toBeDisabled();
    const input = screen.getByLabelText('Nom de la pièce');
    await user.type(input, 'Photo');
    expect(add).toBeDisabled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await user.clear(input);
    await user.type(input, 'Justificatif{Enter}');
    const list = screen.getByRole('list', { name: 'Pièces à fournir' });
    expect(within(list).getByText('Justificatif')).toBeInTheDocument();
    expect(input).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Retirer Photo' }));
    expect(within(list).queryByText('Photo')).toBeNull();
    await save(user);
    await screen.findByText('Modifications enregistrées.');
    expect(puts[0].body.requiredDocuments).toEqual(['Acte de naissance', 'Justificatif']);
  });

  it('PUTs the full procedure with the edits, keeping untouched fields as loaded', async () => {
    const { user, puts } = await setup();
    const summary = screen.getByLabelText(/Résumé/);
    await user.clear(summary);
    await user.type(summary, 'Nouveau résumé.');
    const days = screen.getByLabelText(/Délai de traitement/);
    await user.clear(days);
    await user.type(days, '7');
    await save(user);
    expect(await screen.findByText('Modifications enregistrées.')).toBeInTheDocument();
    expect(puts[0].url).toBe('/api/admin/v1/admin/procedures/passeport');
    expect(puts[0].body).toEqual({ ...procedure, summary: 'Nouveau résumé.', processingDays: 7 });
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  });

  it('converts the datetime-local value to an ISO UTC string', async () => {
    expect(isoToLocalInput('2026-03-05T10:30:45.123Z')).toBe('2026-03-05T10:30');
    expect(localInputToIso('2026-03-05T11:45')).toBe('2026-03-05T11:45:00.000Z');
    expect(localInputToIso('')).toBeNull();
    const { user, puts } = await setup();
    const input = screen.getByLabelText(/Consultée le/);
    expect(input).toHaveValue('2026-03-05T10:30');
    await user.clear(input);
    await user.type(input, '2026-04-01T08:15');
    await save(user);
    await screen.findByText('Modifications enregistrées.');
    expect(puts[0].body.source.retrievedAt).toBe('2026-04-01T08:15:00.000Z');
    expect(puts[0].body.source.procedureId).toBe('passeport');
  });

  it('« Valider et publier » PUTs the full procedure as validated, with a Toast and a fresh key', async () => {
    const { user, puts } = await setup();
    expect(screen.queryByRole('button', { name: 'Repasser en brouillon' })).toBeNull();
    await user.type(screen.getByLabelText(/Titre/), ' bis');
    await user.click(screen.getByRole('button', { name: 'Valider et publier' }));
    expect(await screen.findByText('Fiche validée - l’assistant peut la citer')).toBeInTheDocument();
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe('/api/admin/v1/admin/procedures/passeport');
    expect(puts[0].key).toMatch(/^procedure-passeport-/);
    expect(puts[0].body).toEqual({ ...procedure, title: 'Passeport bis', validationStatus: 'validated' });
    expect(screen.getByText('Citée par l’assistant')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider et publier' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Repasser en brouillon' }));
    expect(await screen.findByText('Fiche repassée en brouillon')).toBeInTheDocument();
    expect(puts[1].body.validationStatus).toBe('draft');
    expect(puts[1].key).not.toBe(puts[0].key);
    expect(screen.getByText('Non citée tant qu’en brouillon')).toBeInTheDocument();
  });

  it('keeps the fiche a draft when publishing fails', async () => {
    const { user, puts } = await setup({ onPut: () => problem(503, 'UNAVAILABLE', 'down') });
    await user.click(screen.getByRole('button', { name: 'Valider et publier' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(puts[0].body.validationStatus).toBe('validated');
    expect(screen.getByText('Non citée tant qu’en brouillon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Valider et publier' })).toBeInTheDocument();
  });

  it('cannot publish an invalid fiche', async () => {
    const { user } = await setup();
    await user.clear(screen.getByLabelText(/Titre/));
    expect(screen.getByRole('button', { name: 'Valider et publier' })).toBeDisabled();
  });

  it('shows the form schema as a table and edits the JSON behind a disclosure', async () => {
    const { user, puts } = await setup();
    expect(screen.queryByLabelText(/Schéma du formulaire/)).toBeNull();
    const preview = screen.getByRole('table', { name: 'Aperçu du formulaire' });
    const rows = within(preview).getAllByRole('row').slice(1);
    expect(within(rows[0]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['nom', 'string', 'Oui']);
    expect(within(rows[1]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['age', 'integer', 'Non']);

    await user.click(screen.getByRole('button', { name: 'Modifier le JSON' }));
    const field = screen.getByLabelText(/Schéma du formulaire/);
    await user.clear(field);
    await user.type(field, '{{ nope');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Le JSON est invalide.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
    expect(screen.queryByRole('table', { name: 'Aperçu du formulaire' })).toBeNull();

    await user.clear(field);
    await user.type(field, '[[1]');
    expect(screen.getByText('Le formulaire doit être un objet JSON.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

    await user.clear(field);
    await user.type(field, '{{"type":"object","properties":{{"ville":{{"type":"string"},"cp":{{}},"required":[["cp"]}');
    expect(field).not.toHaveAttribute('aria-invalid');
    const cells = within(screen.getByRole('table', { name: 'Aperçu du formulaire' }))
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell').map((c) => c.textContent));
    expect(cells).toEqual([
      ['ville', 'string', 'Non'],
      ['cp', '-', 'Oui'],
    ]);
    await save(user);
    await screen.findByText('Modifications enregistrées.');
    expect(puts[0].body.formSchema).toEqual({
      type: 'object',
      properties: { ville: { type: 'string' }, cp: {} },
      required: ['cp'],
    });
  });

  it('reuses the key after a 503, takes a new one after an edit, and handles a 409 reload', async () => {
    const { user, puts, fetchMock } = await setup({
      onPut: (call, attempt) =>
        attempt === 1 ? problem(503, 'UNAVAILABLE', 'down') : attempt === 3 ? problem(409, 'CONFLICT', 'x') : json(call.body),
    });
    await user.type(screen.getByLabelText(/Titre/), ' bis');
    await save(user);
    await screen.findByRole('alert');
    await save(user);
    await screen.findByText('Modifications enregistrées.');
    expect(puts[1].key).toBe(puts[0].key);

    await user.type(screen.getByLabelText(/Titre/), '!');
    await save(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('modifiée entre-temps');
    expect(puts[2].key).not.toBe(puts[1].key);
    const gets = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET').length;
    const before = gets();
    await user.click(screen.getByRole('button', { name: 'Recharger' }));
    await waitFor(() => expect(gets()).toBe(before + 1));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
