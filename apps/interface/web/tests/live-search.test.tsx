import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LiveSearch, matchDemarches } from '@/components/home/LiveSearch';

describe('matchDemarches', () => {
  it('ignores accents, case and filler words', () => {
    expect(matchDemarches('PASS').map((m) => m.name)).toEqual(['Passeport', 'Laissez-passer']);
    expect(matchDemarches('comment obtenir un acte de deces').map((m) => m.name)).toEqual(['Acte de décès']);
    expect(matchDemarches('casier')[0]?.name).toBe('Casier judiciaire');
  });

  it('returns nothing for one letter or unknown words', () => {
    expect(matchDemarches('p')).toEqual([]);
    expect(matchDemarches('zzzz')).toEqual([]);
  });
});

describe('LiveSearch', () => {
  it('lists matches and sends the picked question', async () => {
    const onPick = vi.fn();
    render(<LiveSearch query="titre foncier" onPick={onPick} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Titre foncier/ }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith('Comment obtenir un titre foncier ?');
  });

  it('renders nothing without a match', () => {
    const { container } = render(<LiveSearch query="zzzz" onPick={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
