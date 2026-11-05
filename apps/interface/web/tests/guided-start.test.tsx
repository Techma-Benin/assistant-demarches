import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GuidedStart } from '@/components/home/GuidedStart';

describe('GuidedStart', () => {
  it('reaches a démarche in three clicks', async () => {
    const onAsk = vi.fn();
    render(<GuidedStart onAsk={onAsk} />);
    const user = userEvent.setup();
    expect(screen.getByText('Dites-nous d’abord qui vous êtes.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /De la diaspora/ }));
    await user.click(screen.getByRole('button', { name: 'Services consulaires' }));
    await user.click(screen.getByRole('button', { name: /Carte consulaire/ }));
    expect(onAsk).toHaveBeenCalledExactlyOnceWith('Comment obtenir ou renouveler ma carte consulaire ?');
  });

  it('offers business needs to a company', async () => {
    render(<GuidedStart onAsk={() => {}} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Une entreprise/ }));
    expect(screen.getByRole('button', { name: 'Entreprise' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voyage' })).toBeNull();
  });
});
