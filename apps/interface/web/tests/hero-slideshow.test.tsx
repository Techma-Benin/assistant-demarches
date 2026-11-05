import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HERO_PHOTOS, HeroSlideshow } from '@/components/home/HeroSlideshow';

const visible = () => screen.getAllByRole('img').filter((img) => img.getAttribute('aria-hidden') !== 'true');
const all = () => Array.from(document.querySelectorAll('img'));

function mockMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('HeroSlideshow', () => {
  beforeEach(() => mockMotion(false));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('has five photos, the Porte du non-retour by day', () => {
    expect(HERO_PHOTOS).toHaveLength(5);
    expect(HERO_PHOTOS.map((p) => p.src)).toContain('/photos/porte-non-retour-ouidah.jpg');
    expect(HERO_PHOTOS.map((p) => p.src)).not.toContain('/photos/porte-non-retour-ouidah-nuit.jpg');
  });

  it('renders every photo, only the first one exposed', () => {
    render(<HeroSlideshow />);
    expect(all()).toHaveLength(HERO_PHOTOS.length);
    HERO_PHOTOS.forEach((p, i) => expect(all()[i]).toHaveAttribute('alt', p.alt));
    expect(visible()).toHaveLength(1);
    expect(visible()[0]).toHaveAttribute('alt', HERO_PHOTOS[0]!.alt);
    expect(all()[0]).toHaveClass('opacity-100');
    expect(all()[1]).toHaveClass('opacity-0');
  });

  it('next and previous change the active photo and wrap around', async () => {
    render(<HeroSlideshow />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Photo précédente' }));
    expect(visible()[0]).toHaveAttribute('alt', HERO_PHOTOS[HERO_PHOTOS.length - 1]!.alt);
    await user.click(screen.getByRole('button', { name: 'Photo suivante' }));
    expect(visible()[0]).toHaveAttribute('alt', HERO_PHOTOS[0]!.alt);
    await user.click(screen.getByRole('button', { name: 'Photo suivante' }));
    expect(visible()[0]).toHaveAttribute('alt', HERO_PHOTOS[1]!.alt);
  });

  it('the pause button toggles its label', async () => {
    render(<HeroSlideshow />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Mettre le diaporama en pause' }));
    expect(screen.getByRole('button', { name: 'Lire le diaporama' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lire le diaporama' }));
    expect(screen.getByRole('button', { name: 'Mettre le diaporama en pause' })).toBeInTheDocument();
  });

  it('advances when the 6-second progress bar ends, and holds the bar while paused', () => {
    render(<HeroSlideshow />);
    const bar = () => document.querySelector('.hero-progress') as HTMLElement;
    expect(bar().style.animationDuration).toBe('6000ms');
    act(() => {
      for (const type of ['animationend', 'webkitAnimationEnd']) bar().dispatchEvent(new Event(type, { bubbles: true }));
    });
    expect(visible()[0]).toHaveAttribute('alt', HERO_PHOTOS[1]!.alt);
    act(() => screen.getByRole('button', { name: 'Mettre le diaporama en pause' }).click());
    expect(bar().style.animationPlayState).toBe('paused');
  });

  it('plays under reduced motion too, with the pause button available', () => {
    mockMotion(true);
    render(<HeroSlideshow />);
    expect(screen.getByRole('button', { name: 'Mettre le diaporama en pause' })).toBeInTheDocument();
    expect((document.querySelector('.hero-progress') as HTMLElement).style.animationPlayState).toBe('running');
  });
});
