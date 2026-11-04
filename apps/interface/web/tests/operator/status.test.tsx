import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusPage } from '@/components/operator/status/status-page';
import { assertContract, json, problem, status, stubOperator } from './helpers';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => vi.unstubAllGlobals());

describe('Statut', () => {
  it('fixture conforms to the v2 contract', () => assertContract('OperatorStatus', status));

  it('draws the connection schema and opens Modèles and Connexions from it', async () => {
    stubOperator((call) => (call.path === '/status' ? json(status) : undefined));
    render(<StatusPage />);

    expect(await screen.findByRole('region', { name: 'Schéma des connexions' })).toBeInTheDocument();
    expect(screen.getByText('Assistant')).toBeInTheDocument();

    const model = screen.getByRole('link', { name: /Modèle/ });
    expect(model).toHaveAttribute('href', '/operateur/modeles');
    expect(within(model).getByText('Groq Llama')).toBeInTheDocument();
    expect(within(model).getByText('Joignable')).toBeInTheDocument();

    const mcp = screen.getByRole('link', { name: /Serveurs MCP/ });
    expect(mcp).toHaveAttribute('href', '/operateur/mcp');
    expect(within(mcp).getByText(/Serveur Techma · 2 outils/)).toBeInTheDocument();
    expect(within(mcp).getByText(/Autre serveur · 0 outil/)).toBeInTheDocument();
    expect(within(mcp).getByText('Injoignable')).toBeInTheDocument();
  });

  it('keeps only connected administrations, with no way to connect the others', async () => {
    stubOperator((call) => (call.path === '/status' ? json(status) : undefined));
    render(<StatusPage />);

    const schema = await screen.findByRole('region', { name: 'Schéma des connexions' });
    const admins = within(schema).getByRole('heading', { name: 'Administrations' }).closest('.op-status-card')!;
    expect(within(admins).getByText('Justice')).toBeInTheDocument();
    expect(within(admins).getByText('1 connectée')).toBeInTheDocument();
    expect(within(admins).queryByText('ANIP')).not.toBeInTheDocument();
    expect(screen.queryByText('Non connectée')).not.toBeInTheDocument();
    expect(within(admins).queryByRole('link')).not.toBeInTheDocument();
  });

  it('says when no administration is connected', async () => {
    stubOperator((call) =>
      call.path === '/status' ? json({ ...status, administrations: [status.administrations[1]] }) : undefined,
    );
    render(<StatusPage />);
    expect(await screen.findByText('Aucune administration connectée.')).toBeInTheDocument();
    expect(screen.queryByText('ANIP')).not.toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: /Modèle/ })).toHaveAttribute('href', '/operateur/modeles');
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
