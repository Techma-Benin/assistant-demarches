import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelsOverview } from '@/components/operator/models/models-overview';
import { formatTemperature } from '@/lib/admin/format';
import { json, problem, stubC3 } from '../admin/helpers/c3-fetch';

const principal = { id: 'principal', provider: 'openai', model: 'gpt-4.1-mini', promptVersion: 'agent-v1', temperature: 0.2, active: true };
const secours = { id: 'secours', provider: 'anthropic', model: 'claude-sonnet-5-5', promptVersion: 'agent-v2', temperature: 0.5, active: false };

afterEach(() => vi.unstubAllGlobals());

describe('ModelsOverview', () => {
  it('shows the active model in the large tile and marks it « En service »', async () => {
    stubC3({ lists: { models: [[principal, secours]] } });
    render(<ModelsOverview />);
    expect(await screen.findByRole('heading', { level: 2, name: 'gpt-4.1-mini' })).toBeInTheDocument();
    expect(screen.getByText('Modèle actif')).toBeInTheDocument();
    expect(screen.getByText('En service')).toBeInTheDocument();
    expect(screen.getAllByText('agent-v1').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Température · 0,2/)).toHaveAttribute('step', '0.1');
    expect(screen.getByText(/une température basse \(0 à 0,3\)/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Activer à la place/ })).toHaveLength(1);
  });

  it('activates the new model with PUT active:true THEN active:false on the old one', async () => {
    const { puts } = stubC3({ lists: { models: [[principal, secours]] } });
    render(<ModelsOverview />);
    await userEvent.setup().click(await screen.findByRole('button', { name: /Activer à la place/ }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts.map((p) => [p.url, p.body.active])).toEqual([
      ['/api/admin/v1/admin/models/secours', true],
      ['/api/admin/v1/admin/models/principal', false],
    ]);
    expect(puts[0].body).toEqual({ ...secours, active: true });
    expect(puts[1].body).toEqual({ ...principal, active: false });
    expect(puts[0].key).not.toBe(puts[1].key);
    expect(await screen.findByRole('heading', { level: 2, name: 'claude-sonnet-5-5' })).toBeInTheDocument();
    expect(screen.getByText('Modèle actif : claude-sonnet-5-5')).toBeInTheDocument();
  });

  it('shows the backend error in an alert and reloads when the activation is rejected', async () => {
    const { puts, fetchMock } = stubC3({
      lists: { models: [[principal, secours]] },
      onPut: () => problem(422, 'INVALID_STATE', 'Un seul modèle peut être actif.'),
    });
    render(<ModelsOverview />);
    const gets = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET').length;
    await screen.findByRole('button', { name: /Activer à la place/ });
    const before = gets();
    await userEvent.setup().click(screen.getByRole('button', { name: /Activer à la place/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Un seul modèle peut être actif.');
    expect(puts).toHaveLength(1); // the old model is not touched when the first PUT fails
    await waitFor(() => expect(gets()).toBe(before + 1));
    expect(screen.getByRole('heading', { level: 2, name: 'gpt-4.1-mini' })).toBeInTheDocument();
  });

  it('saves the temperature explicitly (PUT of the full model)', async () => {
    const { puts } = stubC3({ lists: { models: [[principal, secours]] }, onPut: (call) => json(call.body) });
    render(<ModelsOverview />);
    const slider = await screen.findByLabelText(/Température · 0,2/);
    const save = screen.getByRole('button', { name: 'Enregistrer la température' });
    expect(save).toBeDisabled();
    fireChange(slider, '0.8');
    expect(screen.getByLabelText(/Température · 0,8/)).toBeInTheDocument();
    expect(puts).toHaveLength(0);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Enregistrer la température' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual({ ...principal, temperature: 0.8 });
    expect(await screen.findByText('Température enregistrée')).toBeInTheDocument();
    expect(within(screen.getByText('Température', { selector: 'span' }).parentElement!).getByText('0,8')).toBeInTheDocument();
  });

  it('formats the temperature in French', () => {
    expect(formatTemperature(0.3)).toBe('0,3');
    expect(formatTemperature(2)).toBe('2,0');
  });
});

function fireChange(input: HTMLElement, value: string) {
  // React tracks the value setter: use the native one so onChange fires.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
