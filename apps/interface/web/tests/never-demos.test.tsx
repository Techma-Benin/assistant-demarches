import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NeverShowcase } from '@/components/home/NeverDemos';

const card = (title: RegExp) => screen.getByRole('heading', { level: 3, name: title }).closest('li') as HTMLElement;

describe('NeverShowcase', () => {
  it('shows the four promises at once, each with what you do instead', () => {
    render(<NeverShowcase />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Ce que l’assistant ne fera jamais.');
    for (const t of ['Voir votre NPI', 'Vous demander un code SMS', 'Répondre sans source', 'Agir sans votre accord'])
      expect(screen.getByRole('heading', { level: 3, name: t })).toBeInTheDocument();
    expect(within(card(/Voir votre NPI/)).getByText(/connexion sécurisée/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Essayez' })).toHaveLength(4);
  });

  it('plays the exchange under the cards on « Essayez », one at a time', () => {
    render(<NeverShowcase />);
    expect(screen.queryByText('Je vous donne mon NPI pour aller plus vite ?')).toBeNull();
    fireEvent.click(within(card(/Voir votre NPI/)).getByRole('button', { name: 'Essayez' }));
    expect(screen.getByText('Je vous donne mon NPI pour aller plus vite ?')).toBeInTheDocument();
    expect(screen.getByText(/je ne vois jamais votre NPI/)).toBeInTheDocument();
    expect(within(card(/Voir votre NPI/)).getByRole('button', { name: 'Revoir' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(card(/Agir sans votre accord/)).getByRole('button', { name: 'Essayez' }));
    expect(screen.queryByText('Je vous donne mon NPI pour aller plus vite ?')).toBeNull();
    expect(screen.getByText('D’abord votre accord : je ne fais rien sans lui.')).toBeInTheDocument();
    expect(within(document.getElementById('promise-stage')!).getByText(/L’assistant peut agir sur votre demande/)).toBeInTheDocument();
  });

  it('keeps the citation line and the proof elements', () => {
    render(<NeverShowcase />);
    expect(screen.getByText(/chaque réponse cite sa fiche officielle/)).toBeInTheDocument();
  });
});
