import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HowItWorksPoster, POSTER_STEP_MS } from '@/components/home/HowItWorksPoster';

const steps = () => within(screen.getByRole('list')).getAllByRole('listitem');
const current = () => steps().findIndex((li) => li.getAttribute('aria-current') === 'step');

describe('HowItWorksPoster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps the three steps in order for every reader, the first one shown', () => {
    render(<HowItWorksPoster />);
    expect(steps()).toHaveLength(3);
    expect(steps()[0]).toHaveTextContent('Étape 1 sur 3');
    expect(steps()[0]).toHaveTextContent('À l’écrit ou à voix haute');
    expect(steps()[1]).toHaveTextContent('L’assistant prépare.');
    expect(steps()[2]).toHaveTextContent('Rien ne part sans votre accord.');
    expect(current()).toBe(0);
  });

  it('moves to the next step on its own, and the pause button stops it', () => {
    render(<HowItWorksPoster />);
    act(() => void vi.advanceTimersByTime(POSTER_STEP_MS[0]!));
    expect(current()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Mettre les étapes en pause' }));
    act(() => void vi.advanceTimersByTime(20000));
    expect(current()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Lire les étapes' }));
    act(() => void vi.advanceTimersByTime(POSTER_STEP_MS[1]!));
    expect(current()).toBe(2);
  });

  it('jumps to a step from its bar and loops back after the last one', () => {
    render(<HowItWorksPoster />);
    fireEvent.click(screen.getByRole('button', { name: 'Étape 3 : Vous gardez la main' }));
    expect(current()).toBe(2);
    expect(screen.getByRole('button', { name: 'Étape 3 : Vous gardez la main' })).toHaveAttribute('aria-current', 'step');
    act(() => void vi.advanceTimersByTime(POSTER_STEP_MS[2]!));
    expect(current()).toBe(0);
  });

  it('shows the confirmation only in the last step, and keeps the illustrations away from assistive tech', () => {
    render(<HowItWorksPoster />);
    expect(screen.queryByText('DÉPOSÉE')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Étape 3 : Vous gardez la main' }));
    const done = screen.getByText('DÉPOSÉE');
    expect(done.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
