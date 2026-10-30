import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelEdit } from '@/components/model-edit';
import { json, problem, stubC3 } from './helpers/c3-fetch';

const model = { id: 'demo-model', provider: 'mock', model: 'deterministic', promptVersion: 'v1', temperature: 0.5, active: true };

afterEach(() => vi.unstubAllGlobals());

async function setup(options: Parameters<typeof stubC3>[0] = { lists: { models: [[model]] } }) {
  const stub = stubC3(options);
  render(<ModelEdit id="demo-model" />);
  await screen.findByRole('button', { name: 'Enregistrer' });
  return { ...stub, user: userEvent.setup() };
}

describe('ModelEdit', () => {
  it('shows the resource name, a back link and a disabled save when unchanged', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'demo-model' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Retour aux modèles/ })).toHaveAttribute('href', '/models');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Annuler les modifications' })).toBeDisabled();
  });

  it('finds the model on a later page', async () => {
    stubC3({ lists: { models: [[{ ...model, id: 'other' }], [model]] } });
    render(<ModelEdit id="demo-model" />);
    expect(await screen.findByLabelText(/Fournisseur/)).toHaveValue('mock');
  });

  it('shows a missing state when absent', async () => {
    stubC3({ lists: { models: [[]] } });
    render(<ModelEdit id="gone" />);
    expect(await screen.findByText('Cette ressource n’existe plus.')).toBeInTheDocument();
  });

  it('blocks save on invalid values with accessible errors', async () => {
    const { user } = await setup();
    const temperature = screen.getByLabelText(/Température/);
    await user.clear(temperature);
    await user.type(temperature, '3');
    expect(temperature).toHaveAttribute('aria-invalid', 'true');
    expect(temperature).toHaveAccessibleDescription(/entre 0 et 2/i);
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
    await user.clear(screen.getByLabelText(/Fournisseur/));
    expect(screen.getByLabelText(/Fournisseur/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  });

  it('shows the unsaved-changes status only when dirty', async () => {
    const { user } = await setup();
    expect(screen.getByText('Aucune modification')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Fournisseur/), 'x');
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
    expect(screen.queryByText('Aucune modification')).toBeNull();
  });

  it('PUTs the full model with the edits and rebases on the response', async () => {
    const { user, puts } = await setup();
    const temperature = screen.getByLabelText(/Température/);
    await user.clear(temperature);
    await user.type(temperature, '1.2');
    await user.click(screen.getByRole('switch', { name: 'Actif' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Modifications enregistrées.')).toBeInTheDocument();
    expect(puts[0].url).toBe('/api/admin/v1/admin/models/demo-model');
    expect(puts[0].body).toEqual({ ...model, temperature: 1.2, active: false });
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  });

  it('resets to the loaded value', async () => {
    const { user } = await setup();
    await user.type(screen.getByLabelText(/Fournisseur/), 'x');
    await user.click(screen.getByRole('button', { name: 'Annuler les modifications' }));
    expect(screen.getByLabelText(/Fournisseur/)).toHaveValue('mock');
  });

  it('reuses the idempotency key after a 503 and takes a new one once the form changes', async () => {
    const { user, puts } = await setup({
      lists: { models: [[model]] },
      onPut: (call, attempt) => (attempt <= 2 ? problem(503, 'UNAVAILABLE', 'down') : json(call.body)),
    });
    await user.type(screen.getByLabelText(/Fournisseur/), 'x');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Service indisponible. Réessayez.');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].key).toBe(puts[0].key);
    await screen.findByRole('alert');
    await user.type(screen.getByLabelText(/Fournisseur/), 'y');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Modifications enregistrées.')).toBeInTheDocument();
    expect(puts[2].key).not.toBe(puts[0].key);
  });

  it('shows the 409 message and reloads the resource', async () => {
    const { user, fetchMock } = await setup({
      lists: { models: [[model]] },
      onPut: () => problem(409, 'CONFLICT', 'conflit'),
    });
    await user.type(screen.getByLabelText(/Fournisseur/), 'x');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cette ressource a été modifiée entre-temps. Rechargez la page avant de recommencer.',
    );
    const gets = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET').length;
    const before = gets();
    await user.click(screen.getByRole('button', { name: 'Recharger' }));
    await waitFor(() => expect(gets()).toBe(before + 1));
    await waitFor(() => expect(screen.getByLabelText(/Fournisseur/)).toHaveValue('mock'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [400, 'INVALID_REQUEST', 'Données refusées : température invalide'],
    [404, 'NOT_FOUND', 'Cette ressource n’existe plus.'],
    [500, 'INTERNAL', 'Impossible d’enregistrer les modifications.'],
  ])('maps a %i to a message', async (status, code, expected) => {
    const { user } = await setup({
      lists: { models: [[model]] },
      onPut: () => problem(status, code, 'température invalide'),
    });
    await user.type(screen.getByLabelText(/Fournisseur/), 'x');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
  });

  it('warns on unload only while dirty', async () => {
    const { user } = await setup();
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await user.type(screen.getByLabelText(/Fournisseur/), 'x');
    expect(unload()).toBe(true);
  });
});
