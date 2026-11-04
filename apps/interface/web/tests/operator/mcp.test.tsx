import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpPage } from '@/components/operator/mcp/mcp-page';
import { assertContract, json, problem, searchTool, stubOperator, submitTool, techma } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const base = (tools = [searchTool, submitTool]) => (call: { method: string; path: string }) => {
  if (call.method === 'GET' && call.path === '/mcp-servers') return json({ items: [techma], nextCursor: null });
  if (call.method === 'GET' && call.path === '/mcp-servers/techma/tools') return json({ items: tools, discoveredAt: '2026-11-02T09:00:00Z' });
};

async function openTools(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Outils de Serveur Techma' }));
}

describe('fixtures', () => {
  it('conform to the v2 contract', () => {
    assertContract('McpServer', techma);
    assertContract('McpTool', searchTool);
    assertContract('McpToolList', { items: [searchTool], discoveredAt: null });
  });
});

describe('Connexions MCP', () => {
  it('lists connections and shows tools in a dialog with the default-disabled note', async () => {
    const user = userEvent.setup();
    stubOperator(base());
    render(<McpPage />);
    expect(await screen.findByText('Serveur Techma')).toBeInTheDocument();
    expect(screen.getByText(/désactivés par défaut/)).toBeInTheDocument();
    await openTools(user);
    const table = await screen.findByRole('table', { name: 'Outils de Serveur Techma' });
    expect(within(table).getByRole('columnheader', { name: 'Activé' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Consentement requis' })).toBeInTheDocument();
    expect(within(table).getByRole('switch', { name: 'Activé : procedures.search' })).toHaveAttribute('aria-checked', 'false');
    expect(within(table).getByRole('switch', { name: 'Activé : request.submit' })).toHaveAttribute('aria-checked', 'true');
    expect(within(table).getByRole('switch', { name: 'Consentement requis : procedures.search' })).toHaveAttribute('aria-checked', 'true');
  });

  it('adds a server by URL with a contract-valid body', async () => {
    const user = userEvent.setup();
    const calls = stubOperator((call) => (call.method === 'POST' ? json(call.body, 201) : undefined), base());
    render(<McpPage />);
    await user.click(await screen.findByRole('button', { name: 'Ajouter une connexion' }));
    const form = screen.getByRole('form', { name: 'Ajouter une connexion' });
    await user.type(within(form).getByLabelText(/^Nom/), 'Serveur Techma');
    await user.type(within(form).getByLabelText(/Adresse du serveur/), 'http://mcp.example/mcp');
    await user.click(within(form).getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/mcp-servers');
    expect(post.body).toEqual({ id: 'serveur-techma', name: 'Serveur Techma', url: 'http://mcp.example/mcp', enabled: true, auth: { type: 'none' } });
    assertContract('McpServer', post.body);
  });

  it('updates a server with PUT', async () => {
    const user = userEvent.setup();
    const calls = stubOperator((call) => (call.method === 'PUT' && call.path === '/mcp-servers/techma' ? json(call.body) : undefined), base());
    render(<McpPage />);
    await user.click(await screen.findByRole('button', { name: 'Modifier Serveur Techma' }));
    const form = screen.getByRole('form', { name: 'Modifier Serveur Techma' });
    const name = within(form).getByLabelText(/^Nom/);
    await user.clear(name);
    await user.type(name, 'Techma renommé');
    await user.click(within(form).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/mcp-servers/techma')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/mcp-servers/techma')!;
    expect(put.body).toMatchObject({ id: 'techma', name: 'Techma renommé', url: techma.url });
    assertContract('McpServer', put.body);
  });

  it('sends a bearer secretRef as an environment variable name only', async () => {
    const user = userEvent.setup();
    const calls = stubOperator((call) => (call.method === 'POST' ? json(call.body, 201) : undefined), base());
    render(<McpPage />);
    await user.click(await screen.findByRole('button', { name: 'Ajouter une connexion' }));
    const form = screen.getByRole('form', { name: 'Ajouter une connexion' });
    await user.type(within(form).getByLabelText(/^Nom/), 'Privé');
    await user.type(within(form).getByLabelText(/Adresse du serveur/), 'https://prive.example/mcp');
    await user.selectOptions(within(form).getByLabelText('Authentification'), 'bearer');
    const ref = within(form).getByLabelText(/Variable du jeton/);
    await user.type(ref, 'eyJhbGciOi');
    await user.click(within(form).getByRole('button', { name: 'Ajouter' }));
    expect(ref).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await user.clear(ref);
    await user.type(ref, 'PRIVE_TOKEN');
    await user.click(within(form).getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({ auth: { type: 'bearer', secretRef: 'PRIVE_TOKEN' } });
    assertContract('McpServer', post.body);
  });

  it('shows the server refusal for a URL outside MCP_ALLOWED_URLS', async () => {
    const user = userEvent.setup();
    stubOperator((call) => (call.method === 'POST' ? problem(400, 'INVALID_REQUEST', 'Adresse non autorisée (MCP_ALLOWED_URLS).') : undefined), base());
    render(<McpPage />);
    await user.click(await screen.findByRole('button', { name: 'Ajouter une connexion' }));
    const form = screen.getByRole('form', { name: 'Ajouter une connexion' });
    await user.type(within(form).getByLabelText(/^Nom/), 'Autre');
    await user.type(within(form).getByLabelText(/Adresse du serveur/), 'https://evil.example/mcp');
    await user.click(within(form).getByRole('button', { name: 'Ajouter' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Adresse non autorisée (MCP_ALLOWED_URLS).');
  });

  it('discovers the tools and shows the new list in the dialog', async () => {
    const user = userEvent.setup();
    const found = { ...searchTool, name: 'procedures.get', description: 'Lit une démarche.' };
    let discovered = false;
    const calls = stubOperator(
      (call) => {
        if (call.method === 'POST' && call.path === '/mcp-servers/techma/discover') {
          discovered = true;
          return json({ items: [found], discoveredAt: '2026-11-02T10:00:00Z' });
        }
        return undefined;
      },
      (call) => {
        if (call.method === 'GET' && call.path === '/mcp-servers/techma/tools') {
          return json(
            discovered
              ? { items: [found], discoveredAt: '2026-11-02T10:00:00Z' }
              : { items: [searchTool, submitTool], discoveredAt: '2026-11-02T09:00:00Z' },
          );
        }
        return base()(call);
      },
    );
    render(<McpPage />);
    await user.click(await screen.findByRole('button', { name: 'Actualiser les outils de Serveur Techma' }));
    await openTools(user);
    expect(await screen.findByRole('switch', { name: 'Activé : procedures.get' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('switch', { name: 'Activé : request.submit' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/mcp-servers/techma/discover')).toBe(true);
  });

  it('shows the discovery failure', async () => {
    const user = userEvent.setup();
    stubOperator((call) => (call.method === 'POST' ? problem(502, 'MCP_DISCOVERY_FAILED', 'Découverte impossible.') : undefined), base());
    render(<McpPage />);
    await user.click(await screen.findByRole('button', { name: 'Actualiser les outils de Serveur Techma' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Découverte impossible.');
  });

  it('toggles enabled and requiresMandate with PUT on the tool, keeping the other flag', async () => {
    const user = userEvent.setup();
    const calls = stubOperator((call) => (call.method === 'PUT' ? json({ ...searchTool, ...(call.body as object) }) : undefined), base());
    render(<McpPage />);
    await openTools(user);
    const enabled = await screen.findByRole('switch', { name: 'Activé : procedures.search' });
    await user.click(enabled);
    await waitFor(() => expect(enabled).toHaveAttribute('aria-checked', 'true'));
    let put = calls.filter((c) => c.method === 'PUT')[0];
    expect(put.path).toBe('/mcp-servers/techma/tools/procedures.search');
    expect(put.body).toEqual({ enabled: true, requiresMandate: true });
    assertContract('McpToolPermission', put.body);

    const consent = screen.getByRole('switch', { name: 'Consentement requis : procedures.search' });
    await user.click(consent);
    await waitFor(() => expect(consent).toHaveAttribute('aria-checked', 'false'));
    put = calls.filter((c) => c.method === 'PUT')[1];
    expect(put.body).toEqual({ enabled: true, requiresMandate: false });
  });

  it('keeps the previous state and shows the problem when a toggle fails', async () => {
    const user = userEvent.setup();
    stubOperator((call) => (call.method === 'PUT' ? problem(503, 'UPSTREAM_UNAVAILABLE', 'Service momentanément indisponible') : undefined), base());
    render(<McpPage />);
    await openTools(user);
    const enabled = await screen.findByRole('switch', { name: 'Activé : procedures.search' });
    await user.click(enabled);
    expect(await screen.findByRole('alert')).toHaveTextContent('Service momentanément indisponible');
    expect(enabled).toHaveAttribute('aria-checked', 'false');
  });

  it('deletes a server only after confirmation', async () => {
    const user = userEvent.setup();
    let deleted = false;
    const calls = stubOperator(
      (call) => {
        if (call.method === 'DELETE') {
          deleted = true;
          return new Response(null, { status: 204 });
        }
        return undefined;
      },
      (call) => {
        if (call.method === 'GET' && call.path === '/mcp-servers') {
          return json({ items: deleted ? [] : [techma], nextCursor: null });
        }
        return base()(call);
      },
    );
    render(<McpPage />);
    await user.click(await screen.findByRole('button', { name: 'Supprimer Serveur Techma' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Outils de Serveur Techma' })).not.toBeInTheDocument());
    expect(calls.find((c) => c.method === 'DELETE')!.path).toBe('/mcp-servers/techma');
    expect(screen.getByText(/Aucun serveur MCP/)).toBeInTheDocument();
  });
});
