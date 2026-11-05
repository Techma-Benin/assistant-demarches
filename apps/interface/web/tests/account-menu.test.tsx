import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountMenu } from '@/components/app/AccountMenu';
import { loadConversation, saveConversation } from '@/lib/conversation-persistence';

const session = (user: unknown) => vi.fn(async () => new Response(JSON.stringify({ user }), { status: 200 }));

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('AccountMenu', () => {
  it('renders nothing for a guest', async () => {
    const fetchMock = session(null);
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<AccountMenu />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the session cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    const { container } = render(<AccountMenu />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('opens a panel with the name, the cases link and the logout form', async () => {
    vi.stubGlobal('fetch', session({ name: 'Awa Dossou', roles: ['citizen'] }));
    render(<AccountMenu />);
    const trigger = await screen.findByRole('button', { name: 'Mon compte' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(trigger.getAttribute('aria-controls')!)).toBeInTheDocument();
    expect(screen.getByText('Awa Dossou')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mes démarches' })).toHaveAttribute('href', '/demarches');
    const logout = screen.getByRole('button', { name: 'Se déconnecter' });
    const form = logout.closest('form')!;
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/auth/logout');
  });

  it('forgets the saved conversation when signing out', async () => {
    vi.stubGlobal('fetch', session({ name: 'Awa', roles: [] }));
    saveConversation({ conversationId: 'cnv_1' });
    render(<AccountMenu />);
    await userEvent.click(await screen.findByRole('button', { name: 'Mon compte' }));
    const form = screen.getByRole('button', { name: 'Se déconnecter' }).closest('form')!;
    // jsdom does not implement form submission: keep it from navigating, the submit handler still runs.
    form.addEventListener('submit', (event) => event.preventDefault());
    await userEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(loadConversation()).toBeNull();
  });

  it('closes on Escape with focus back on the trigger, and on an outside click', async () => {
    vi.stubGlobal('fetch', session({ name: 'Awa', roles: [] }));
    render(<AccountMenu />);
    const trigger = await screen.findByRole('button', { name: 'Mon compte' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Mes démarches' })).toBeNull();
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.click(document.body);
    expect(screen.queryByRole('link', { name: 'Mes démarches' })).toBeNull();
  });
});
