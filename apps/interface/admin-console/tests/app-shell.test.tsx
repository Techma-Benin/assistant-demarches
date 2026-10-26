import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/shell/app-shell';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

beforeEach(() => {
  pathname = '/';
});

describe('AppShell', () => {
  it('renders the six nav links and marks the active one', () => {
    pathname = '/models';
    render(<AppShell>contenu</AppShell>);
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(nav.querySelectorAll('a')).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Modèles' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tableau de bord' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Fiches de démarche' })).toHaveAttribute('href', '/procedures');
    expect(screen.getByText('Démo')).toBeInTheDocument();
    expect(screen.getByText('contenu')).toBeInTheDocument();
  });

  it('only marks the dashboard active on /', () => {
    render(<AppShell>x</AppShell>);
    expect(screen.getByRole('link', { name: 'Tableau de bord' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Journal d’audit' })).not.toHaveAttribute('aria-current');
  });

  it('toggles the mobile menu with aria-expanded', async () => {
    render(<AppShell>x</AppShell>);
    const button = screen.getByRole('button', { name: 'Ouvrir le menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('console-nav')?.className).toContain('hidden');
    await userEvent.setup().click(button);
    const open = screen.getByRole('button', { name: 'Fermer le menu' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('console-nav')?.className).not.toContain('hidden');
  });
});
