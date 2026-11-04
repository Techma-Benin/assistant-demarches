import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OperatorLayout from '@/app/operateur/layout';

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
    render(await OperatorLayout({ children: <p>contenu</p> }));
    expect(screen.getByText('contenu')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Statut', 'Modèles', 'Connexions']);
    expect(screen.getByRole('link', { name: 'Statut' })).toHaveAttribute('href', '/operateur');
    expect(screen.getByRole('link', { name: 'Modèles' })).toHaveAttribute('href', '/operateur/modeles');
    expect(screen.getByRole('link', { name: 'Connexions' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Statut' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Se déconnecter' }).closest('form')).toHaveAttribute('action', '/auth/logout');
    expect(screen.getByRole('button', { name: /Thème/ })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(main.className).toContain('w-full');
    expect(main.className).not.toContain('max-w-5xl');
    expect(main.className).not.toContain('mx-auto');
  });
});
