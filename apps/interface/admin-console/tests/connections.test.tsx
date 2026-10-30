import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolsTable } from '@/components/tools-table';
import { groupToolsByServer, serverHost } from '@/lib/tool-servers';
import { stubC3 } from './helpers/c3-fetch';

const A = 'https://mcp.alpha.example/mcp';
const B = 'http://127.0.0.1:4020/mcp';
const tools = [
  { name: 'search', enabled: true, serverUrl: A, secretRef: 'alpha-secret' },
  { name: 'request.submit', enabled: false, serverUrl: A, secretRef: 'alpha-secret' },
  { name: 'lookup', enabled: true, serverUrl: B, secretRef: 'mock-only' },
];

afterEach(() => vi.unstubAllGlobals());

describe('tool servers', () => {
  it('groups tools by serverUrl, keeping the order of first appearance', () => {
    const servers = groupToolsByServer(tools);
    expect(servers.map((s) => [s.url, s.host, s.tools.map((t) => t.name), s.secretRefs])).toEqual([
      [A, 'mcp.alpha.example', ['search', 'request.submit'], ['alpha-secret']],
      [B, '127.0.0.1:4020', ['lookup'], ['mock-only']],
    ]);
    expect(serverHost('pas une url')).toBe('pas une url');
  });
});

describe('Connexions MCP', () => {
  it('shows one card per server and filters the actions table on the selected one', async () => {
    stubC3({ lists: { tools: [tools] } });
    render(<ToolsTable />);
    const first = await screen.findByRole('button', { name: /mcp\.alpha\.example/ });
    const second = screen.getByRole('button', { name: /127\.0\.0\.1:4020/ });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveAttribute('aria-pressed', 'false');
    expect(within(first).getByText(A)).toBeInTheDocument();
    expect(within(first).getByText('auth bearer · alpha-secret')).toBeInTheDocument();
    expect(within(first).getByText('2 actions')).toBeInTheDocument();
    expect(within(first).getByText('1 activée')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Actions de « mcp.alpha.example »' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Activer search' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Activer lookup' })).toBeNull();

    await userEvent.setup().click(second);
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('switch', { name: 'Activer lookup' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Activer search' })).toBeNull();
  });

  it('toggles an action (PUT enabled), updates the enabled count and shows a Toast', async () => {
    const { puts } = stubC3({ lists: { tools: [tools] } });
    render(<ToolsTable />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('switch', { name: 'Activer request.submit' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual({ ...tools[1], enabled: true });
    expect(await screen.findByText('Action activée : request.submit')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /mcp\.alpha\.example/ })).getByText('2 activées')).toBeInTheDocument();
  });

  it('never shows anything but the secretRef', async () => {
    stubC3({ lists: { tools: [tools] } });
    render(<ToolsTable />);
    await screen.findByRole('switch', { name: 'Activer search' });
    expect(screen.getByText(/seule une référence/)).toBeInTheDocument();
    expect(screen.queryByText('Ajouter une connexion')).toBeNull();
  });
});
