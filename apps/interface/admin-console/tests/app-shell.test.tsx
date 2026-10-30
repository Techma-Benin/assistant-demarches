import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/shell/app-shell';
import { PageHeader } from '@/components/page-header';
import { stubC3 } from './helpers/c3-fetch';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

beforeEach(() => {
  pathname = '/';
  stubC3({ lists: {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AppShell', () => {
  it('renders the six nav links and marks the active one', () => {
    pathname = '/models';
    render(<AppShell>contenu</AppShell>);
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(nav.querySelectorAll('a')).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Modèle IA' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Vue d’ensemble' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Fiches' })).toHaveAttribute('href', '/procedures');
    expect(screen.getByRole('link', { name: 'Connexions MCP' })).toHaveAttribute('href', '/tools');
    expect(screen.queryByText('Démo')).toBeNull();
    expect(screen.getByText('contenu')).toBeInTheDocument();
  });

  it('only marks the dashboard active on /', () => {
    render(<AppShell>x</AppShell>);
    expect(screen.getByRole('link', { name: 'Vue d’ensemble' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Journal d’audit' })).not.toHaveAttribute('aria-current');
  });

  it('shows badges for drafts and disabled tools, and the service status', async () => {
    stubC3({
      lists: {
        procedures: [[{ id: 'a', validationStatus: 'draft' }, { id: 'b', validationStatus: 'draft' }, { id: 'c', validationStatus: 'validated' }]],
        tools: [[
          { name: 't1', enabled: true, serverUrl: 'https://a' },
          { name: 't2', enabled: true, serverUrl: 'https://a' },
          { name: 't3', enabled: true, serverUrl: 'https://b' },
          { name: 't4', enabled: false, serverUrl: 'https://c' },
        ]],
        models: [[{ id: 'm', provider: 'acme', model: 'big-1', active: true }]],
      },
    });
    render(<AppShell>x</AppShell>);
    expect(await screen.findByRole('link', { name: 'Fiches, 2 à traiter' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connexions MCP, 1 à traiter' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conversations' })).toBeInTheDocument();
    expect(screen.getByText('Backend joignable')).toBeInTheDocument();
    expect(screen.getByText('2 connexions MCP')).toBeInTheDocument();
    expect(screen.getByText('acme · big-1')).toBeInTheDocument();
  });

  it('fails silently when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('down'))));
    render(<AppShell>x</AppShell>);
    expect(await screen.findByText('Backend injoignable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fiches' })).toBeInTheDocument();
  });

  it('toggles the mobile menu with aria-expanded', async () => {
    render(<AppShell>x</AppShell>);
    const button = screen.getByRole('button', { name: 'Ouvrir le menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    // The closed panel stays mounted but is out of the tab order and the a11y tree (inert).
    expect(document.getElementById('console-nav')).toHaveAttribute('inert');
    await userEvent.setup().click(button);
    const open = screen.getByRole('button', { name: 'Fermer le menu' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('console-nav')).not.toHaveAttribute('inert');
    expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeInTheDocument();
  });
});

describe('PageHeader', () => {
  it('shows the sample-data pill only when NEXT_PUBLIC_SAMPLE_DATA is true', () => {
    const { rerender } = render(<PageHeader title="T" description="d" actions={<button>Act</button>} />);
    expect(screen.queryByText('Données d’exemple')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'T' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument();
    vi.stubEnv('NEXT_PUBLIC_SAMPLE_DATA', 'true');
    rerender(<PageHeader title="T" />);
    expect(screen.getByText('Données d’exemple')).toBeInTheDocument();
  });
});
