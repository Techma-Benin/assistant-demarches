import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OperatorLayout from '@/app/operateur/layout';
import { OPERATOR_NAV_COLLAPSED_KEY } from '@/components/operator/shell/operator-shell';

const readSession = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock('@/server/auth/session', () => ({ readSession: () => readSession() }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url), usePathname: () => '/operateur/mcp' }));

const user = (roles: string[], refreshExpiresAt = Date.now() + 60_000) => ({ user: { roles, refreshExpiresAt } });

beforeEach(() => {
  readSession.mockReset();
  redirect.mockClear();
  localStorage.clear();
});

describe('operator layout gate', () => {
  it('redirects to the login with returnTo when nobody is signed in', async () => {
    readSession.mockResolvedValue({});
    await expect(OperatorLayout({ children: null })).rejects.toThrow('REDIRECT:/auth/login?returnTo=/operateur');
  });

  it('redirects when the refresh token has expired', async () => {
    readSession.mockResolvedValue(user(['operator'], Date.now() - 1));
    await expect(OperatorLayout({ children: null })).rejects.toThrow('REDIRECT:/auth/login?returnTo=/operateur');
  });

  it('shows the access page with a logout form to a user without the operator role', async () => {
    readSession.mockResolvedValue(user(['official']));
    render(await OperatorLayout({ children: <p>secret</p> }));
    expect(screen.getByText('Accès réservé à l’opérateur.')).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Se déconnecter' });
    const form = button.closest('form')!;
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/auth/logout');
  });

  it('renders the operator shell with its navigation for an operator', async () => {
    readSession.mockResolvedValue(user(['operator']));
    const { container } = render(await OperatorLayout({ children: <p>contenu</p> }));
    expect(screen.getByText('contenu')).toBeInTheDocument();
    expect(screen.getByText('Démarches')).toBeInTheDocument();
    expect(screen.getByText('Console opérateur')).toBeInTheDocument();
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Statut', 'Modèles', 'Connexions']);
    const activeLink = screen.getByRole('link', { name: 'Connexions' });
    expect(activeLink.className).not.toContain('rounded-field');
    expect(activeLink.className).toContain('rounded-none');
    expect(activeLink.className).toContain('w-full');
    expect(activeLink.className).toContain('max-md:bg-canvas');
    expect(activeLink.className).toContain('md:min-h-12');
    expect(activeLink.className).toContain('md:py-3.5');
    const aside = container.querySelector('aside')!;
    expect(aside.className).not.toMatch(/border-r/);
    expect(aside.className).not.toMatch(/border-b/);
    const indicator = nav.querySelector('[data-nav-indicator]')!;
    expect(indicator).toBeTruthy();
    expect(indicator.innerHTML).toContain('bg-canvas');
    expect(indicator.innerHTML).not.toContain('bg-action');
    const statutIcon = screen.getByRole('link', { name: 'Statut' }).querySelector('svg')!;
    const connexionsIcon = activeLink.querySelector('svg')!;
    expect(statutIcon.getAttribute('fill')).toBe('none');
    expect(connexionsIcon.getAttribute('fill')).toBe('none');
    expect(statutIcon.getAttribute('stroke-width')).toBe(connexionsIcon.getAttribute('stroke-width'));
    expect(screen.getByRole('link', { name: 'Statut' })).toHaveAttribute('href', '/operateur');
    expect(screen.getByRole('link', { name: 'Modèles' })).toHaveAttribute('href', '/operateur/modeles');
    expect(activeLink).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Statut' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Replier le menu latéral' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Se déconnecter' }).closest('form')).toHaveAttribute('action', '/auth/logout');
    expect(screen.getByRole('button', { name: 'Thème' })).toBeInTheDocument();
    const shell = container.firstElementChild!;
    expect(shell.className).toContain('md:grid-cols-[15rem_minmax(0,1fr)]');
    const main = screen.getByRole('main');
    expect(main.className).toContain('w-full');
    expect(main.className).not.toContain('max-w-5xl');
    expect(main.className).not.toContain('mx-auto');
  });

  it('persists sidebar collapse in localStorage', async () => {
    readSession.mockResolvedValue(user(['operator']));
    const ui = userEvent.setup();
    const { container } = render(await OperatorLayout({ children: <p>contenu</p> }));
    await ui.click(screen.getByRole('button', { name: 'Replier le menu latéral' }));
    expect(localStorage.getItem(OPERATOR_NAV_COLLAPSED_KEY)).toBe('true');
    expect(screen.getByRole('button', { name: 'Déplier le menu latéral' })).toHaveAttribute('aria-expanded', 'false');
    const shell = screen.getByText('contenu').closest('.min-h-dvh')!;
    expect(shell.className).toContain('md:grid-cols-[4.25rem_minmax(0,1fr)]');
    expect(shell).toHaveAttribute('data-collapsed', '');
    const activeLink = screen.getByRole('link', { name: 'Connexions' });
    expect(activeLink.className).toContain('md:size-12');
    expect(activeLink.className).toContain('md:mx-auto');
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    const indicator = nav.querySelector('[data-nav-indicator]') as HTMLElement;
    const width = Number.parseFloat(indicator.style.width);
    const height = Number.parseFloat(indicator.style.height);
    if (width > 0 && height > 0) {
      expect(width).toBe(height);
    }
    expect(container.querySelector('[data-nav-indicator]')).toBeTruthy();
  });
});
