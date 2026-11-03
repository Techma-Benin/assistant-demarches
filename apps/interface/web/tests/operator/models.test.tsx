import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelsPage } from '@/components/operator/models/models-page';
import { assertContract, groq, json, mistral, problem, stubOperator } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const list = (items = [groq, mistral]) => (call: { method: string; path: string }) =>
  call.method === 'GET' && call.path.startsWith('/models') ? json({ items, nextCursor: null }) : undefined;

describe('fixtures', () => {
  it('conform to the v2 contract', () => {
    assertContract('ModelConfig', groq);
    assertContract('ModelConfig', mistral);
  });
});

describe('Modèles', () => {
  it('lists the models and marks the active one', async () => {
    stubOperator(list());
    render(<ModelsPage />);
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Actif')).toBeInTheDocument();
    expect(within(items[0]).queryByRole('button', { name: /Activer/ })).not.toBeInTheDocument();
    expect(within(items[1]).queryByText('Actif')).not.toBeInTheDocument();
    expect(within(items[1]).getByRole('button', { name: 'Activer Mistral Small' })).toBeInTheDocument();
    // The reference is displayed as a plain name, not masked.
    expect(within(items[0]).getByText('GROQ_API_KEY')).toBeInTheDocument();
  });

  it('shows the load error and retries', async () => {
    let fail = true;
    stubOperator((call) => (call.method === 'GET' ? (fail ? problem(503, 'UPSTREAM_UNAVAILABLE', 'Service momentanément indisponible') : json({ items: [groq], nextCursor: null })) : undefined));
    render(<ModelsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Service momentanément indisponible');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Groq Llama')).toBeInTheDocument();
  });

  it('creates a model from the form with a contract-valid body and an id derived from the name', async () => {
    const calls = stubOperator(
      (call) => (call.method === 'POST' ? json(call.body, 201) : undefined),
      list([groq]),
    );
    render(<ModelsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ajouter un modèle' }));
    const form = screen.getByRole('form', { name: 'Ajouter un modèle' });
    expect(within(form).getByText('Nom de la variable d’environnement qui contient la clé, jamais la clé elle-même.')).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText(/^Nom/), 'Mistral Été');
    await userEvent.type(within(form).getByLabelText(/Adresse du service/), 'https://api.mistral.ai/v1');
    await userEvent.selectOptions(within(form).getByLabelText(/Protocole/), 'responses');
    await userEvent.type(within(form).getByLabelText(/^Modèle/), 'mistral-small-latest');
    await userEvent.type(within(form).getByLabelText(/Clé d’accès/), 'MISTRAL_API_KEY');
    await userEvent.clear(within(form).getByLabelText(/Température/));
    await userEvent.type(within(form).getByLabelText(/Température/), '0.5');
    await userEvent.click(within(form).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/models');
    expect(post.body).toEqual({
      id: 'mistral-ete',
      label: 'Mistral Été',
      baseUrl: 'https://api.mistral.ai/v1',
      protocol: 'responses',
      model: 'mistral-small-latest',
      apiKeyRef: 'MISTRAL_API_KEY',
      temperature: 0.5,
      active: false,
    });
    assertContract('ModelConfig', post.body);
    expect(await screen.findByText('« Mistral Été » est enregistré.')).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('never accepts a key value in apiKeyRef and ties the error to the field', async () => {
    const calls = stubOperator(list([groq]));
    render(<ModelsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ajouter un modèle' }));
    const form = screen.getByRole('form', { name: 'Ajouter un modèle' });
    await userEvent.type(within(form).getByLabelText(/^Nom/), 'Test');
    await userEvent.type(within(form).getByLabelText(/Adresse du service/), 'https://x.example/v1');
    await userEvent.type(within(form).getByLabelText(/^Modèle/), 'm');
    const ref = within(form).getByLabelText(/Clé d’accès/);
    expect(ref).toHaveAttribute('type', 'text');
    await userEvent.type(ref, 'sk-abc123secret');
    await userEvent.click(within(form).getByRole('button', { name: 'Enregistrer' }));
    expect(ref).toHaveAttribute('aria-invalid', 'true');
    const describedBy = ref.getAttribute('aria-describedby')!.split(' ');
    const errorId = describedBy.find((id) => id.endsWith('-error'))!;
    expect(document.getElementById(errorId)).toHaveTextContent('Ne collez jamais la clé elle-même');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('edits a model with PUT keeping its id and active flag', async () => {
    const calls = stubOperator((call) => (call.method === 'PUT' ? json(call.body) : undefined), list());
    render(<ModelsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier Groq Llama' }));
    const form = screen.getByRole('form', { name: 'Modifier Groq Llama' });
    const temperature = within(form).getByLabelText(/Température/);
    await userEvent.clear(temperature);
    await userEvent.type(temperature, '1.2');
    await userEvent.click(within(form).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe('/models/groq-llama');
    expect(put.body).toEqual({ ...groq, temperature: 1.2 });
    assertContract('ModelConfig', put.body);
  });

  it('shows the server problem when saving fails', async () => {
    stubOperator((call) => (call.method === 'POST' ? problem(400, 'INVALID_REQUEST', 'Adresse refusée') : undefined), list([groq]));
    render(<ModelsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ajouter un modèle' }));
    const form = screen.getByRole('form', { name: 'Ajouter un modèle' });
    await userEvent.type(within(form).getByLabelText(/^Nom/), 'Test');
    await userEvent.type(within(form).getByLabelText(/Adresse du service/), 'https://x.example/v1');
    await userEvent.type(within(form).getByLabelText(/^Modèle/), 'm');
    await userEvent.type(within(form).getByLabelText(/Clé d’accès/), 'TEST_KEY');
    await userEvent.click(within(form).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Adresse refusée');
  });

  it('activates a model with PUT active:true and reloads', async () => {
    let activated = false;
    const calls = stubOperator(
      (call) => {
        if (call.method === 'PUT') {
          activated = true;
          return json(call.body);
        }
      },
      (call) => (call.method === 'GET' ? json({ items: activated ? [{ ...groq, active: false }, { ...mistral, active: true }] : [groq, mistral], nextCursor: null }) : undefined),
    );
    render(<ModelsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Activer Mistral Small' }));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe('/models/mistral-small');
    expect(put.body).toEqual({ ...mistral, active: true });
    await waitFor(() => {
      const items = screen.getAllByRole('listitem');
      expect(within(items[1]).getByText('Actif')).toBeInTheDocument();
      expect(within(items[0]).queryByText('Actif')).not.toBeInTheDocument();
    });
    expect(screen.getByText('« Mistral Small » est le modèle actif.')).toBeInTheDocument();
  });

  it('asks for confirmation before deleting, and can cancel', async () => {
    const calls = stubOperator(list());
    render(<ModelsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer Mistral Small' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('button', { name: 'Confirmer la suppression' })).not.toBeInTheDocument();
  });

  it('deletes after confirmation', async () => {
    let deleted = false;
    const calls = stubOperator(
      (call) => {
        if (call.method === 'DELETE') {
          deleted = true;
          return new Response(null, { status: 204 });
        }
      },
      (call) => (call.method === 'GET' ? json({ items: deleted ? [groq] : [groq, mistral], nextCursor: null }) : undefined),
    );
    render(<ModelsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer Mistral Small' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'DELETE')!.path).toBe('/models/mistral-small');
  });

  it('shows the server refusal when deleting the active model', async () => {
    stubOperator(
      (call) => (call.method === 'DELETE' ? problem(409, 'CONFLICT', 'Le modèle actif ne peut pas être supprimé.') : undefined),
      list(),
    );
    render(<ModelsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer Groq Llama' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Le modèle actif ne peut pas être supprimé.');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
