import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AskDemo, PrepareDemo, ValidateDemo } from '@/components/home/HowItWorksDemos';

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

// Small ticks so each step's effect re-arms before the next timeout fires.
const advance = (ms: number) => {
  for (let t = 0; t < ms; t += 25) act(() => void vi.advanceTimersByTime(25));
};

describe('How it works demos', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockEnv(false);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is hidden from assistive tech and inert', () => {
    const { container } = render(<AskDemo />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root).toHaveAttribute('inert');
  });

  it('AskDemo types, sends, consults, then holds that frame', () => {
    render(<AskDemo />);
    expect(screen.getByText('Posez votre question…')).toBeInTheDocument();
    expect(screen.queryByText('Reçu')).not.toBeInTheDocument();
    advance(600 + 3000);
    expect(screen.getByText('Il me faut un acte de naissance pour mon fils')).toBeInTheDocument();
    expect(screen.getByText('Reçu')).toBeInTheDocument();
    advance(1300);
    expect(screen.getByText('Je consulte la fiche officielle…')).toBeInTheDocument();
    advance(20000);
    expect(screen.getByText('Reçu')).toBeInTheDocument();
    expect(screen.getByText('Je consulte la fiche officielle…')).toBeInTheDocument();
  });

  it('PrepareDemo reaches the created request, then holds it', () => {
    render(<PrepareDemo />);
    expect(screen.queryByText('Demande créée')).not.toBeInTheDocument();
    advance(400 + 2060 + 800 + 800 + 800 + 400 + 100);
    expect(screen.getByText('Demande créée')).toBeInTheDocument();
    expect(screen.getByText('Dossier reçu')).toBeInTheDocument();
    advance(20000);
    expect(screen.getByText('Demande créée')).toBeInTheDocument();
  });

  it('ValidateDemo ends on Déposée, then holds it', () => {
    render(<ValidateDemo />);
    expect(screen.getByText('Prêt à valider')).toBeInTheDocument();
    advance(900 + 800 + 350 + 1000 + 100);
    expect(screen.getByText('Déposée')).toBeInTheDocument();
    advance(20000);
    expect(screen.getByText('Déposée')).toBeInTheDocument();
  });

  it('still plays under reduced motion', () => {
    mockEnv(true);
    render(<AskDemo />);
    expect(screen.queryByText('Reçu')).not.toBeInTheDocument();
    advance(600 + 3000);
    expect(screen.getByText('Reçu')).toBeInTheDocument();
  });
});
