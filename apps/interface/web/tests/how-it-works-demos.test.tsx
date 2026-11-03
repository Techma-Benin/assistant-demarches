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

  it('AskDemo types, sends, consults, then loops back to empty', () => {
    render(<AskDemo />);
    expect(screen.getByText('Posez votre question…')).toBeInTheDocument();
    expect(screen.queryByText('Reçu')).not.toBeInTheDocument();
    advance(600 + 3000);
    expect(screen.getByText('Il me faut un acte de naissance pour mon fils')).toBeInTheDocument();
    expect(screen.getByText('Reçu')).toBeInTheDocument();
    advance(1300);
    expect(screen.getByText('Je consulte la fiche officielle…')).toBeInTheDocument();
    advance(3400 + 500 + 100);
    expect(screen.queryByText('Reçu')).not.toBeInTheDocument();
    expect(screen.getByText('Posez votre question…')).toBeInTheDocument();
  });

  it('PrepareDemo reaches the created request, then restarts', () => {
    render(<PrepareDemo />);
    expect(screen.queryByText('Demande créée')).not.toBeInTheDocument();
    advance(400 + 2060 + 800 + 800 + 800 + 400 + 100);
    expect(screen.getByText('Demande créée')).toBeInTheDocument();
    expect(screen.getByText('Dossier reçu')).toBeInTheDocument();
    advance(3400 + 500 + 600 + 100);
    expect(screen.queryByText('Demande créée')).not.toBeInTheDocument();
  });

  it('ValidateDemo ends on Déposée, then restarts', () => {
    render(<ValidateDemo />);
    expect(screen.getByText('Prêt à valider')).toBeInTheDocument();
    advance(900 + 800 + 350 + 1000 + 100);
    expect(screen.getByText('Déposée')).toBeInTheDocument();
    advance(3200 + 500 + 400);
    expect(screen.getByText('Prêt à valider')).toBeInTheDocument();
  });

  it('renders the final frames immediately under reduced motion', () => {
    mockEnv(true);
    const ask = render(<AskDemo />);
    expect(screen.getByText('Reçu')).toBeInTheDocument();
    expect(screen.getByText('Je consulte la fiche officielle…')).toBeInTheDocument();
    ask.unmount();
    const prep = render(<PrepareDemo />);
    expect(screen.getByText('Demande créée')).toBeInTheDocument();
    expect(screen.getByText('Dossier reçu')).toBeInTheDocument();
    prep.unmount();
    render(<ValidateDemo />);
    expect(screen.getByText('Déposée')).toBeInTheDocument();
  });
});
