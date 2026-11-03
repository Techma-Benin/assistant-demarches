'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Minimal modal: focus moves into it, Escape closes it unless `dismissible` is false. */
export function Dialog({
  title,
  onClose,
  dismissible = true,
  children,
}: {
  title: string;
  onClose: () => void;
  dismissible?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && dismissible) {
            event.stopPropagation();
            onClose();
          }
        }}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-(--ui-shadow-pop) focus:outline-none"
      >
        <h2 id={titleId} className="font-display text-2xl font-extrabold tracking-[-0.035em]">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
