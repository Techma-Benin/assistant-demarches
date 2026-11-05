import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CatalogueSection } from '@/components/home/CatalogueSection';

const setup = (disabled = false) => {
  const onAsk = vi.fn();
  const onAskOther = vi.fn();
  render(<CatalogueSection disabled={disabled} onAsk={onAsk} onAskOther={onAskOther} />);
  return { onAsk, onAskOther, user: userEvent.setup() };
};

describe('CatalogueSection', () => {
  it('lists the six themes as tabs, the first selected', () => {
    setup();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);
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
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Voyage');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/Voyage/);
  });

  it('arrow keys, Home and End move focus and selection', async () => {
    const { user } = setup();
    screen.getAllByRole('tab')[0]!.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: /État civil/ })).toHaveFocus();
    expect(screen.getByRole('tab', { name: /État civil/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('tab', { name: /Foncier et logement/ })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: /Identité/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: /Foncier et logement/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('an item calls onAsk with its question', async () => {
    const { user, onAsk } = setup();
    await user.click(screen.getByRole('button', { name: /Certificat de nationalité/ }));
    expect(onAsk).toHaveBeenCalledExactlyOnceWith('Comment obtenir un certificat de nationalité ?');
  });

  it('« Demander à l’assistant » asks the first item of the theme', async () => {
    const { user, onAsk } = setup();
    await user.click(screen.getByRole('tab', { name: /Justice/ }));
    await user.click(screen.getByRole('button', { name: 'Demander à l’assistant' }));
    expect(onAsk).toHaveBeenCalledExactlyOnceWith('Comment obtenir un extrait de casier judiciaire ?');
  });

  it('disabled blocks the asks but not the tabs', async () => {
    const { user, onAsk } = setup(true);
    expect(screen.getByRole('button', { name: 'Demander à l’assistant' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Carte d’identité/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Carte d’identité/ }));
    await user.click(screen.getByRole('tab', { name: /Voyage/ }));
    expect(onAsk).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /Voyage/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('« Poser ma question » calls onAskOther', async () => {
    const { user, onAskOther } = setup();
    await user.click(screen.getByRole('button', { name: 'Poser ma question' }));
    expect(onAskOther).toHaveBeenCalledOnce();
  });
});
