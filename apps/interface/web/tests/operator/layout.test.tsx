import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OperatorLayout from '@/app/operateur/layout';
import { OPERATOR_NAV_COLLAPSED_KEY } from '@/components/operator/shell/operator-shell';
import { RAIL_COLLAPSED, RAIL_WIDTH_KEY, clampExpandedWidth } from '@/components/shell/rail-resize';

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
  delete document.documentElement.dataset.theme;
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
    expect(activeLink.className).toContain('md:h-16');
    expect(activeLink.className).toContain('md:py-2');
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
    const topCorner = indicator.querySelector('[data-nav-corner="top"] span') as HTMLElement;
    const bottomCorner = indicator.querySelector('[data-nav-corner="bottom"] span') as HTMLElement;
    expect(topCorner.className).toContain('rounded-br-full');
    expect(topCorner.className).toContain('bg-shell-rail');
    expect(bottomCorner.className).toContain('rounded-tr-full');
    expect(bottomCorner.className).toContain('bg-shell-rail');
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
    expect(screen.queryByRole('button', { name: 'Replier le menu latéral' })).toBeNull();
    const account = screen.getByRole('button', { name: 'Opérateur' });
    expect(account).toHaveAttribute('aria-haspopup', 'menu');
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thème' })).toBeNull();
    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toContain('md:grid-cols-[var(--rail-width)_minmax(0,1fr)]');
    expect(shell.style.getPropertyValue('--rail-width')).toBe('200px');
    const main = screen.getByRole('main');
    expect(main.className).toContain('z-10');
    expect(main.className).toContain('bg-canvas');
    expect(main.className).not.toContain('shadow-rail');
    const grip = screen.getByRole('separator', { name: 'Redimensionner le menu latéral' });
    expect(grip.className).toContain('top-1/2');
    expect(grip.className).toContain('cursor-col-resize');
    expect(grip.className).toContain('right-0.5');
    expect(grip.className).not.toContain('-translate-x-1/2');
    expect(grip.closest('aside')).toBeTruthy();
    expect(grip.querySelectorAll('[data-rail-stroke]')).toHaveLength(2);
    const shadows = container.querySelectorAll('[data-rail-shadow][data-rail-cutout]');
    expect(shadows).toHaveLength(2);
    expect((shadows[0] as HTMLElement).style.height).toContain('--rail-cut-top');
    expect((shadows[1] as HTMLElement).style.top).toContain('--rail-cut-top');
    expect(shell.style.getPropertyValue('--rail-cut-top')).toContain('--nav-active-index');
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
    const shell = screen.getByText('contenu').closest('.min-h-dvh') as HTMLElement;
    expect(shell.style.getPropertyValue('--nav-active-index')).toBe('1');
    expect(shell.querySelector('[data-rail-shadow]')).toHaveAttribute('data-rail-cutout', '');
  });

  it('persists sidebar collapse in localStorage', async () => {
    readSession.mockResolvedValue(user(['operator']));
    const ui = userEvent.setup();
    const { container } = render(await OperatorLayout({ children: <p>contenu</p> }));
    const grip = screen.getByRole('separator', { name: 'Redimensionner le menu latéral' });
    grip.focus();
    await ui.keyboard('{ArrowLeft}');
    expect(localStorage.getItem(OPERATOR_NAV_COLLAPSED_KEY)).toBe('true');
    expect(screen.queryByRole('button', { name: 'Déplier le menu latéral' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Replier le menu latéral' })).toBeNull();
    expect(container.querySelectorAll('aside svg[width="28"]')).toHaveLength(2);
    expect(container.querySelector('aside svg.lucide-chevrons-left, aside svg.lucide-chevrons-right')).toBeNull();
    expect(container.querySelector('[data-rail-shadow]')).not.toHaveAttribute('data-rail-cutout');
    const shell = screen.getByText('contenu').closest('.min-h-dvh') as HTMLElement;
    expect(shell.style.getPropertyValue('--rail-width')).toBe(RAIL_COLLAPSED);
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
    expect(screen.getByRole('button', { name: 'Opérateur' })).toBeInTheDocument();
  });

  it('caps the shared expanded width at the smaller of 320px and 32vw', () => {
    expect(clampExpandedWidth(480, 1600)).toBe(320);
    expect(clampExpandedWidth(480, 800)).toBe(256);
    expect(clampExpandedWidth(120, 1600)).toBe(200);
  });

  it('resizes from the grip, collapses under the minimum, and keeps the shared width', async () => {
    readSession.mockResolvedValue(user(['operator']));
    localStorage.setItem(RAIL_WIDTH_KEY, '280');
    const ui = userEvent.setup();
    const { container } = render(await OperatorLayout({ children: <p>contenu</p> }));
    const shell = container.firstElementChild as HTMLElement;
    const grip = screen.getByRole('separator', { name: 'Redimensionner le menu latéral' });
    expect(shell.style.getPropertyValue('--rail-width')).toBe('280px');
    expect(shell.querySelector('[data-rail-shadow]')).toHaveAttribute('data-rail-cutout', '');

    grip.focus();
    await ui.keyboard('{ArrowRight}');
    expect(shell.style.getPropertyValue('--rail-width')).toBe('296px');
    expect(localStorage.getItem(RAIL_WIDTH_KEY)).toBe('296');
    for (let step = 0; step < 4; step += 1) await ui.keyboard('{ArrowRight}');
    expect(localStorage.getItem(RAIL_WIDTH_KEY)).toBe('320');
    await ui.keyboard('{ArrowRight}');
    expect(localStorage.getItem(RAIL_WIDTH_KEY)).toBe('320');

    fireEvent.pointerDown(grip, { button: 0, clientX: 400, pointerId: 1 });
    expect(shell.className).toContain('md:transition-none');
    fireEvent.pointerMove(grip, { clientX: 340, pointerId: 1 });
    expect(shell.style.getPropertyValue('--rail-width')).toBe('260px');
    fireEvent.pointerUp(grip, { clientX: 340, pointerId: 1 });
    expect(shell.className).toContain('md:transition-[grid-template-columns,--rail-cut-top]');

    fireEvent.pointerDown(grip, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientX: 200, pointerId: 1 });
    expect(shell).toHaveAttribute('data-collapsed', '');
    expect(shell.style.getPropertyValue('--rail-width')).toBe(RAIL_COLLAPSED);
    expect(localStorage.getItem(OPERATOR_NAV_COLLAPSED_KEY)).toBe('true');

    fireEvent.pointerDown(grip, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 80, pointerId: 1 });
    expect(shell.style.getPropertyValue('--rail-width')).toBe(RAIL_COLLAPSED);
    fireEvent.pointerUp(grip, { clientX: 80, pointerId: 1 });

    fireEvent.pointerDown(grip, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 160, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientX: 160, pointerId: 1 });
    expect(shell).not.toHaveAttribute('data-collapsed');
    expect(shell.style.getPropertyValue('--rail-width')).toBe('228px');
    expect(localStorage.getItem(RAIL_WIDTH_KEY)).toBe('228');
    expect(screen.getByRole('button', { name: 'Opérateur' }).parentElement).toHaveClass('md:mt-auto');
  });

  it('opens the account menu for the theme and sign-out', async () => {
    readSession.mockResolvedValue(user(['operator']));
    const ui = userEvent.setup();
    render(await OperatorLayout({ children: <p>contenu</p> }));
    const account = screen.getByRole('button', { name: 'Opérateur' });
    await ui.click(account);
    expect(account).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Compte' });
    expect(within(menu).getByText('Opérateur')).toBeInTheDocument();
    const theme = within(menu).getByRole('menuitem', { name: 'Thème : système' });
    await ui.click(theme);
    expect(within(menu).getByRole('menuitem', { name: 'Thème : clair' })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('techma-theme')).toBe('light');
    const logout = within(menu).getByRole('menuitem', { name: 'Se déconnecter' });
    const form = logout.closest('form')!;
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/auth/logout');
    await ui.keyboard('{Escape}');
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu', { name: 'Compte' })).toBeNull();
    expect(account).toHaveFocus();
  });
});
