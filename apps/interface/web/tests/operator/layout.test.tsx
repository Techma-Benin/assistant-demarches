import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OperatorLayout from '@/app/operateur/layout';
import { OPERATOR_NAV_COLLAPSED_KEY } from '@/components/operator/shell/operator-shell';

const readSession = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const usePathname = vi.fn(() => '/operateur/mcp');
vi.mock('@/server/auth/session', () => ({ readSession: () => readSession() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
  usePathname: () => usePathname(),
}));

const user = (roles: string[], refreshExpiresAt = Date.now() + 60_000) => ({ user: { roles, refreshExpiresAt } });

beforeEach(() => {
  readSession.mockReset();
  redirect.mockClear();
  usePathname.mockReset();
  usePathname.mockReturnValue('/operateur/mcp');
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
    expect(activeLink.className).toContain('md:bg-transparent');
    expect(activeLink.className.split(' ')).not.toContain('md:bg-canvas');
    expect(activeLink.className).toContain('md:h-[51px]');
    expect(activeLink.className).toContain('md:py-3.5');
    const aside = container.querySelector('aside')!;
    expect(aside.className).not.toMatch(/border-r/);
    expect(aside.className).not.toMatch(/border-b/);
    const track = nav.querySelector('[data-operator-nav-track]')!;
    expect(track.getAttribute('data-nav-active-index')).toBe('2');
    const indicator = nav.querySelector('[data-nav-indicator]') as HTMLElement;
    expect(indicator).toBeTruthy();
    expect(indicator.className).toContain('inset-x-0');
    expect(indicator.innerHTML).toContain('bg-canvas');
    const activeBar = indicator.querySelector('[data-nav-active-bar]') as HTMLElement;
    expect(activeBar).toBeTruthy();
    expect(activeBar.className).toContain('rounded-none');
    expect(activeBar.className).toContain('left-0');
    expect(activeBar.className).toContain('w-0.5');
    expect(activeBar.className).toContain('bg-ink-subtle');
    expect(indicator.style.transform).toContain('var(--nav-active-index');
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

  it('slides the nav indicator when the active route changes', async () => {
    readSession.mockResolvedValue(user(['operator']));
    usePathname.mockReturnValue('/operateur');
    const { rerender } = render(await OperatorLayout({ children: <p>contenu</p> }));
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    const track = nav.querySelector('[data-operator-nav-track]')!;
    const indicator = nav.querySelector('[data-nav-indicator]') as HTMLElement;
    expect(track.getAttribute('data-nav-active-index')).toBe('0');

    usePathname.mockReturnValue('/operateur/modeles');
    rerender(await OperatorLayout({ children: <p>contenu</p> }));
    expect(track.getAttribute('data-nav-active-index')).toBe('1');
    expect(indicator.style.transform).toContain('var(--nav-active-index');
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
    expect(activeLink.className).toContain('md:bg-transparent');
    expect(activeLink.className.split(' ')).not.toContain('bg-canvas');
    expect(activeLink.className).toContain('md:w-full');
    expect(activeLink.className).toContain('md:h-[51px]');
    expect(activeLink.className).not.toContain('md:aspect-square');
    expect(activeLink.className).not.toContain('md:size-12');
    expect(activeLink.className).not.toContain('md:mx-auto');
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    const indicator = nav.querySelector('[data-nav-indicator]') as HTMLElement;
    expect(indicator.className).toContain('inset-x-0');
    const statutLink = screen.getByRole('link', { name: 'Statut' });
    expect(statutLink.className.split(' ')).not.toContain('bg-canvas');
    expect(container.querySelector('aside')!.className).toContain('bg-shell-rail');
  });
});
