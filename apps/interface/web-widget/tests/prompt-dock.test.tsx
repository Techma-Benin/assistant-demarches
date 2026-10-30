import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptDock } from '@/components/home/PromptDock';

let heroBottom = 400;

function Harness({ onSubmit = () => {} }: { onSubmit?: (text: string) => void }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('Brouillon déjà tapé');
  return (
    <>
      <div ref={anchor} data-testid="hero" />
      <PromptDock anchor={anchor} value={value} onValueChange={setValue} onSubmit={onSubmit} />
    </>
  );
}

const dock = () => document.querySelector('[data-shown]') as HTMLElement;
const scrollTo = (bottom: number) => {
  heroBottom = bottom;
  act(() => {
    fireEvent.scroll(window);
  });
};

describe('PromptDock', () => {
  beforeEach(() => {
    heroBottom = 400;
    // Run animation frames synchronously (handle 0: nothing left pending) and give the hero box a controllable position.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const bottom = this.dataset.testid === 'hero' ? heroBottom : 0;
      return { top: bottom - 100, bottom, left: 0, right: 0, width: 0, height: 100, x: 0, y: 0, toJSON: () => ({}) };
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stays hidden and out of reach while the hero box is on screen', () => {
    render(<Harness />);
    expect(dock()).toHaveAttribute('data-shown', 'false');
    expect(dock()).toHaveAttribute('inert');
    scrollTo(-150);
    expect(dock()).toHaveAttribute('data-shown', 'false');
  });

  it('appears once the hero box is 200px above the screen, and folds back when it returns', () => {
    render(<Harness />);
    scrollTo(-260);
    expect(dock()).toHaveAttribute('data-shown', 'true');
    expect(dock()).not.toHaveAttribute('inert');
    scrollTo(120);
    expect(dock()).toHaveAttribute('data-shown', 'false');
  });

  it('carries the draft typed in the hero box and submits it', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    scrollTo(-500);
    const box = screen.getByRole('textbox', { name: 'Poser une question' });
    expect(box).toHaveValue('Brouillon déjà tapé');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('Brouillon déjà tapé');
  });
});
