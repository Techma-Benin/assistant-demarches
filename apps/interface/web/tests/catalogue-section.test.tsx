import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CatalogueSection } from '@/components/home/CatalogueSection';

const setup = (disabled = false) => {
  const onAsk = vi.fn();
  render(<CatalogueSection disabled={disabled} onAsk={onAsk} />);
  return { onAsk, user: userEvent.setup() };
};

describe('CatalogueSection', () => {
  it('lists the seven themes as tabs, the first selected', () => {
    setup();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(7);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Carte d’identité');
  });

  it('clicking a tab switches the panel', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: /Voyage/ }));
    expect(screen.getByRole('tab', { name: /Voyage/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Identité/ })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/Laissez-passer/);
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/Voyage/);
  });

  it('arrow keys, Home and End move focus and selection', async () => {
    const { user } = setup();
    screen.getAllByRole('tab')[0]!.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: /État civil/ })).toHaveFocus();
    expect(screen.getByRole('tab', { name: /État civil/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('tab', { name: /Services consulaires/ })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: /Identité/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: /Services consulaires/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('an item calls onAsk with its question', async () => {
    const { user, onAsk } = setup();
    await user.click(screen.getByRole('button', { name: /Certificat de nationalité/ }));
    expect(onAsk).toHaveBeenCalledExactlyOnceWith('Comment obtenir un certificat de nationalité ?');
  });

  it('shows the theme photo with its démarches on it, without a generic ask button', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: /Justice/ }));
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent('Justice');
    expect(panel.querySelectorAll('li button')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Demander à l’assistant' })).toBeNull();
  });

  it('disabled blocks the asks but not the tabs', async () => {
    const { user, onAsk } = setup(true);
    expect(screen.getByRole('button', { name: /Carte d’identité/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Carte d’identité/ }));
    await user.click(screen.getByRole('tab', { name: /Voyage/ }));
    expect(onAsk).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /Voyage/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the description of the theme being pointed at', async () => {
    const { user } = setup();
    await user.hover(screen.getByRole('tab', { name: /Justice/ }));
    expect(screen.getByText(/Prouver votre situation devant la loi/)).toBeInTheDocument();
    await user.hover(screen.getByRole('button', { name: /Casier judiciaire/ }));
    expect(screen.getByText(/Indique si vous avez des condamnations/)).toBeInTheDocument();
  });
});
