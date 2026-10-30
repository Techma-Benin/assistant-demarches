import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolsTable } from '@/components/tools-table';
import { json, problem, stubC3 } from './helpers/c3-fetch';

const tool = { name: 'search', enabled: true, serverUrl: 'http://127.0.0.1:4020/mcp', secretRef: 'mock-only' };

afterEach(() => vi.unstubAllGlobals());

describe('ToolsTable', () => {
  it('PUTs the full tool with only enabled flipped and keeps the new value', async () => {
    const { puts } = stubC3({ lists: { tools: [[tool]] } });
    render(<ToolsTable />);
    const toggle = await screen.findByRole('switch', { name: 'Activer search' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toBe('/api/admin/v1/admin/tools/search');
    expect(puts[0].body).toEqual({ ...tool, enabled: false });
    expect(puts[0].key).toMatch(/^tool-search-/);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Activer search' })).toBeEnabled());
    expect(screen.getByRole('switch', { name: 'Activer search' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('disables the switch while the request is pending', async () => {
    let release!: () => void;
    stubC3({
      lists: { tools: [[tool]] },
      onPut: (call) => new Promise((resolve) => (release = () => resolve(json(call.body)))),
    });
    render(<ToolsTable />);
    await userEvent.setup().click(await screen.findByRole('switch', { name: 'Activer search' }));
    expect(screen.getByRole('switch', { name: 'Activer search' })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Activer search' })).toBeEnabled());
  });

  it('reverts to the last saved value, not the initially loaded one', async () => {
    let calls = 0;
    stubC3({
      lists: { tools: [[tool]] },
      onPut: (call) => (++calls === 1 ? json(call.body) : problem(503, 'UPSTREAM_UNAVAILABLE', 'Indisponible')),
    });
    render(<ToolsTable />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('switch', { name: 'Activer search' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Activer search' })).toHaveAttribute('aria-checked', 'false'));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Activer search' })).toBeEnabled());
    await user.click(screen.getByRole('switch', { name: 'Activer search' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Activer search' })).toHaveAttribute('aria-checked', 'false');
  });

  it('reverts and shows the mapped message on error, with a fresh key per toggle', async () => {
    const { puts } = stubC3({
      lists: { tools: [[tool]] },
      onPut: () => problem(403, 'FORBIDDEN', 'Rôle administrateur requis'),
    });
    render(<ToolsTable />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('switch', { name: 'Activer search' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Droits insuffisants : il faut le droit admin:write.');
    expect(screen.getByRole('switch', { name: 'Activer search' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('switch', { name: 'Activer search' }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].key).not.toBe(puts[0].key);
  });
});
