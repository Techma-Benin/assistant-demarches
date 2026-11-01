'use client';

import { useEffect, useState, type RefObject } from 'react';
import { cn } from '@techma/ui';
import { Composer } from '@/components/chat/Composer';
import type { useStagedFiles } from '@/hooks/use-staged-files';

/** How far (px) the hero box must scroll above the viewport before the dock shows. */
const REVEAL_OFFSET = 200;

type PromptDockProps = {
  /** The hero question box: the dock shows once it has scrolled out of view, above the viewport. */
  anchor: RefObject<HTMLElement | null>;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (text: string) => void;
  onFiles: (files: File[], note?: string, voice?: { durationMs: number; waveform: number[] }) => void;
  /** Staged files shared with the hero box. */
  staged: ReturnType<typeof useStagedFiles>;
  disabled?: boolean;
};

/**
 * Compact question box docked at the bottom of the screen while the hero box is out of view.
 * It grows from a small pill to full width when it appears, and folds back when the hero box returns.
 */
export function PromptDock({ anchor, value, onValueChange, onSubmit, onFiles, staged, disabled }: PromptDockProps) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const target = anchor.current;
    if (!target) return;
    let frame = 0;
    // Measured on scroll (once per frame): shown once the hero box's bottom is REVEAL_OFFSET above the viewport.
    const update = () => {
      frame = 0;
      setShown(target.getBoundingClientRect().bottom < -REVEAL_OFFSET);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [anchor]);

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[calc(20px+env(safe-area-inset-bottom))] md:pb-8',
      )}
    >
      <div
        // Hidden dock: out of the tab order and of the accessibility tree.
        inert={!shown}
        aria-hidden={!shown}
        data-shown={shown}
        className={cn(
          'w-[304px] max-w-full transition-[width,opacity,transform,visibility] duration-500 ease-(--ui-ease-out) motion-reduce:transition-opacity motion-reduce:duration-200',
          shown
            ? 'pointer-events-auto visible w-[676px] translate-y-0 opacity-100'
            : 'invisible translate-y-3 opacity-0 motion-reduce:translate-y-0',
        )}
      >
        <Composer
          variant="compact"
          label="Poser une question"
          placeholder="Posez votre question…"
          value={value}
          onValueChange={onValueChange}
          onSend={onSubmit}
          onFiles={onFiles}
          staged={staged}
          hint={false}
          disabled={disabled ?? false}
        />
      </div>
    </div>
  );
}
