import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Page from '@/app/embed/page';

vi.mock('@/lib/c1-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/c1-client')>()),
  C1Client: vi.fn(function () {
    return { createConversation: vi.fn(), createSocketTicket: vi.fn(), listEvents: vi.fn(), sendMessage: vi.fn() };
  }),
}));

describe('/embed', () => {
  it('renders the conversation alone, full height, without the site header, front door or footer', () => {
    sessionStorage.clear();
    const { container } = render(<Page />);
    // The chat is there and ready to write, with nothing created yet.
    expect(screen.getByRole('log', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByLabelText('Votre message')).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Bonjour !' })).toBeInTheDocument();
    // None of the site chrome.
    expect(screen.queryByRole('contentinfo')).toBeNull();
    expect(container.querySelector('footer')).toBeNull();
    expect(screen.queryByText('Vos démarches, simplement.')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    // Full height, and the brand link leaves the iframe by opening a new tab.
    expect(container.firstElementChild).toHaveClass('h-dvh');
    expect(screen.getByRole('link', { name: 'Accueil' })).toHaveAttribute('target', '_blank');
  });
});
