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
    expect(within(items[0]).getByText('Groq Llama')).toBeInTheDocument();
    expect(within(items[0]).getByText('Discussion')).toBeInTheDocument();
    expect(within(items[1]).getByText('Discussion')).toBeInTheDocument();
    expect(within(items[0]).getByText('llama-3.3-70b-versatile')).toBeInTheDocument();
  });

  it('keeps technical details out of the list', async () => {
    stubOperator(list());
    render(<ModelsPage />);
    for (const item of await screen.findAllByRole('listitem')) {
      expect(item).not.toHaveTextContent(/api\.(groq|mistral)\.|chat-completions|responses|API_KEY|••••|température/i);
    }
  });

  it('names the icon actions with a tooltip on hover', async () => {
    stubOperator(list());
    render(<ModelsPage />);
    await userEvent.hover(await screen.findByRole('button', { name: 'Modifier Groq Llama' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Modifier');
    await userEvent.unhover(await screen.findByRole('button', { name: 'Modifier Groq Llama' }));
    await userEvent.hover(await screen.findByRole('button', { name: 'Supprimer Groq Llama' }));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Supprimer'));
  });

  it('shows the technical details only in the edit dialog', async () => {
    stubOperator(list());
    render(<ModelsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier Groq Llama' }));
    const dialog = screen.getByRole('dialog', { name: 'Modifier Groq Llama' });
    expect(within(dialog).getByLabelText(/Adresse du service/)).toHaveValue('https://api.groq.com/openai/v1');
    expect(within(dialog).getByLabelText(/Protocole/)).toHaveValue('chat-completions');
    expect(within(dialog).getByLabelText(/Rôle/)).toHaveValue('discussion');
    expect(within(dialog).queryByLabelText(/Température/)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Clé d’accès/)).toHaveValue('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    expect(within(form).queryByText(/chiffrée|conserver la clé|Discussion répond|le plus courant|compatible OpenAI/)).not.toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText(/^Nom/), 'Mistral Été');
    await userEvent.type(within(form).getByLabelText(/Adresse du service/), 'https://api.mistral.ai/v1');
    await userEvent.selectOptions(within(form).getByLabelText(/Protocole/), 'responses');
    await userEvent.type(within(form).getByLabelText(/^Modèle/), 'mistral-small-latest');
    const key = within(form).getByLabelText(/Clé d’accès/);
    expect(key).toHaveAttribute('type', 'password');
    await userEvent.type(key, 'sk-test-operator-key');
    expect(within(form).queryByLabelText(/Température/)).not.toBeInTheDocument();
    expect(within(form).getByLabelText(/Rôle/)).toHaveValue('discussion');
    await userEvent.selectOptions(within(form).getByLabelText(/Rôle/), 'transcription');
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
      apiKeyRef: 'MDL_MISTRAL_ETE',
      apiKey: 'sk-test-operator-key',
      temperature: 0,
      role: 'transcription',
      active: false,
    });
    const { apiKey, ...config } = post.body as { apiKey: string };
    expect(apiKey).toBe('sk-test-operator-key');
    assertContract('ModelConfig', config);
    expect(await screen.findByText('« Mistral Été » est enregistré.')).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('requires a key on create and ties the error to the field', async () => {
    const calls = stubOperator(list([groq]));
    render(<ModelsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ajouter un modèle' }));
    const form = screen.getByRole('form', { name: 'Ajouter un modèle' });
    await userEvent.type(within(form).getByLabelText(/^Nom/), 'Test');
    await userEvent.type(within(form).getByLabelText(/Adresse du service/), 'https://x.example/v1');
    await userEvent.type(within(form).getByLabelText(/^Modèle/), 'm');
    const key = within(form).getByLabelText(/Clé d’accès/);
    expect(key).toHaveAttribute('type', 'password');
    await userEvent.click(within(form).getByRole('button', { name: 'Enregistrer' }));
    expect(key).toHaveAttribute('aria-invalid', 'true');
    const describedBy = key.getAttribute('aria-describedby')!.split(' ');
    const errorId = describedBy.find((id) => id.endsWith('-error'))!;
    expect(document.getElementById(errorId)).toHaveTextContent('Indiquez la clé d’accès du fournisseur');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('edits a model with PUT keeping its id and active flag', async () => {
    const calls = stubOperator((call) => (call.method === 'PUT' ? json(call.body) : undefined), list());
    render(<ModelsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier Groq Llama' }));
    const form = screen.getByRole('form', { name: 'Modifier Groq Llama' });
    expect(within(form).queryByLabelText(/Température/)).not.toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText(/Rôle/), 'transcription');
    await userEvent.click(within(form).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe('/models/groq-llama');
    expect(put.body).toEqual({ ...groq, role: 'transcription' });
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
    await userEvent.type(within(form).getByLabelText(/Clé d’accès/), 'sk-test-key');
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
    expect(screen.getByText('« Mistral Small » est le modèle de discussion actif.')).toBeInTheDocument();
  });

  it('offers to undo an activation by putting the previous model of the same role back', async () => {
    const whisper = { ...groq, id: 'whisper', label: 'Whisper', model: 'whisper-large-v3-turbo', role: 'transcription' as const, active: true };
    let activeId = 'groq-llama';
    const calls = stubOperator(
      (call) => {
        if (call.method === 'PUT') {
          activeId = (call.body as { id: string }).id;
          return json(call.body);
        }
      },
      (call) =>
        call.method === 'GET'
          ? json({
              items: [whisper, ...[groq, mistral].map((m) => ({ ...m, active: m.id === activeId }))],
              nextCursor: null,
            })
          : undefined,
    );
    render(<ModelsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Activer Mistral Small' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts[0].body).toEqual({ ...mistral, active: true });
    expect(puts[1].path).toBe('/models/groq-llama');
    expect(puts[1].body).toEqual({ ...groq, active: true });
    expect(puts.every((call) => (call.body as { id: string }).id !== 'whisper')).toBe(true);
    expect(await screen.findByText('« Groq Llama » est le modèle de discussion actif.')).toBeInTheDocument();
  });

  it('activates a transcription model without clearing the discussion model', async () => {
    const whisper = { ...groq, id: 'whisper', label: 'Whisper', model: 'whisper-large-v3-turbo', role: 'transcription' as const, active: false };
    let voiceActive = false;
    const calls = stubOperator(
      (call) => {
        if (call.method === 'PUT') {
          voiceActive = (call.body as { id: string }).id === 'whisper';
          return json(call.body);
        }
      },
      (call) =>
        call.method === 'GET' ? json({ items: [groq, { ...whisper, active: voiceActive }], nextCursor: null }) : undefined,
    );
    render(<ModelsPage />);
    expect(await screen.findByText('Transcription')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Activer Whisper' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ ...whisper, active: true });
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Actif')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Actif')).toBeInTheDocument();
    expect(screen.getByText('« Whisper » est le modèle de transcription actif.')).toBeInTheDocument();
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
