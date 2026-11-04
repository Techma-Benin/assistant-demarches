import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NeverShowcase } from '@/components/home/NeverDemos';

function mockEnv(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true }]);
      }
      disconnect() {}
    },
  );
}

const advance = (ms: number) => {
  for (let t = 0; t < ms; t += 25) act(() => void vi.advanceTimersByTime(25));
};
const SCENE_MS = 6000;

describe('NeverShowcase', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('animated', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockEnv(false);
    });

    it('lists the refusals and the citation line, chat is hidden and inert', () => {
      const { container } = render(<NeverShowcase />);
      for (const t of ['Voir votre NPI', 'Vous demander un code SMS', 'Répondre sans source', 'Agir sans votre accord'])
        expect(screen.getByRole('button', { name: new RegExp(t) })).toBeInTheDocument();
      expect(screen.getByText(/Chaque information administrative cite sa fiche officielle/)).toBeInTheDocument();
      const chat = container.querySelector('[aria-hidden="true"][inert]');
      expect(chat).not.toBeNull();
    });

    it('plays scene 1, then advances through 2, 3, 4 and loops', () => {
      render(<NeverShowcase />);
      advance(3000);
      expect(screen.getByText(/Pas ici\. Vous vous identifiez/)).toBeInTheDocument();
      expect(screen.getByText('JAMAIS')).toBeInTheDocument();
      advance(SCENE_MS);
      expect(screen.getByText(/Surtout pas/)).toBeInTheDocument();
      expect(screen.getByText('JAMAIS')).toBeInTheDocument();
      advance(SCENE_MS);
      expect(screen.getByText(/tarif de la fiche officielle/)).toBeInTheDocument();
      advance(SCENE_MS);
      expect(screen.getByText(/L’assistant peut agir sur votre demande/)).toBeInTheDocument();
      expect(screen.getByText(/ACCORD\s+REQUIS/)).toBeInTheDocument();
      advance(SCENE_MS);
      expect(screen.getByText(/Pas ici\. Vous vous identifiez/)).toBeInTheDocument();
    });

    it('jumps to a scene on click', () => {
      render(<NeverShowcase />);
      fireEvent.click(screen.getByRole('button', { name: /Répondre sans source/ }));
      expect(screen.getByRole('button', { name: /Répondre sans source/ })).toHaveAttribute('aria-pressed', 'true');
      advance(3000);
      expect(screen.getByText(/tarif de la fiche officielle/)).toBeInTheDocument();
    });
  });

  describe('reduced motion', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockEnv(true);
    });

    it('still plays the scenes', () => {
      render(<NeverShowcase />);
      advance(3000);
      expect(screen.getByText(/Pas ici\. Vous vous identifiez/)).toBeInTheDocument();
      advance(SCENE_MS);
      expect(screen.getByText(/Surtout pas/)).toBeInTheDocument();
    });

    it('switches to a scene on click', () => {
      render(<NeverShowcase />);
      fireEvent.click(screen.getByRole('button', { name: /Agir sans votre accord/ }));
      advance(3000);
      expect(screen.getByText(/L’assistant peut agir sur votre demande/)).toBeInTheDocument();
    });
  });
});
