import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusPage } from '@/components/operator/status/status-page';
import { assertContract, json, problem, status, stubOperator } from './helpers';

afterEach(() => vi.unstubAllGlobals());

describe('Statut', () => {
  it('fixture conforms to the v2 contract', () => assertContract('OperatorStatus', status));

  it('shows the model, the MCP servers with tool counts and the administrations', async () => {
    stubOperator((call) => (call.path === '/status' ? json(status) : undefined));
    render(<StatusPage />);
    const model = (await screen.findByRole('heading', { name: 'Modèle' })).closest('section')!;
    expect(within(model).getByText('Groq Llama')).toBeInTheDocument();
    expect(within(model).getByText('Joignable')).toBeInTheDocument();

    const mcp = screen.getByRole('heading', { name: 'Serveurs MCP' }).closest('section')!;
    const [techma, autre] = within(mcp).getAllByRole('listitem');
    expect(within(techma).getByText(/2 outils/)).toBeInTheDocument();
    expect(within(techma).getByText('Joignable')).toBeInTheDocument();
    expect(within(autre).getByText(/0 outil\b/)).toBeInTheDocument();
    expect(within(autre).getByText('Injoignable')).toBeInTheDocument();

    const admins = screen.getByRole('heading', { name: 'Administrations' }).closest('section')!;
    const [justice, anip] = within(admins).getAllByRole('listitem');
    expect(within(justice).getByText('Connectée')).toBeInTheDocument();
    expect(within(anip).getByText('Non connectée')).toBeInTheDocument();
  });

  it('summarises what needs attention', async () => {
    stubOperator((call) => (call.path === '/status' ? json(status) : undefined));
    const { unmount } = render(<StatusPage />);
    // The enabled server "Autre serveur" is unreachable.
    expect(await screen.findByText('1 point à vérifier.')).toBeInTheDocument();
    unmount();
    stubOperator((call) => (call.path === '/status' ? json({ ...status, mcpServers: [status.mcpServers[0]] }) : undefined));
    render(<StatusPage />);
    expect(await screen.findByText('Tout est opérationnel.')).toBeInTheDocument();
  });

  it('says when no model is active', async () => {
    stubOperator(() => json({ ...status, model: null }));
    render(<StatusPage />);
    expect(await screen.findByText('Aucun modèle actif.')).toBeInTheDocument();
  });

  it('shows the error and refreshes on demand', async () => {
    let fail = true;
    const calls = stubOperator(() => (fail ? problem(503, 'UPSTREAM_UNAVAILABLE', 'Service momentanément indisponible') : json(status)));
    render(<StatusPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Service momentanément indisponible');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
    expect(await screen.findByText('Groq Llama')).toBeInTheDocument();
    expect(calls).toHaveLength(2);
  });
});
