'use client';

import { Check } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '../cn';

export type ToastProps = {
  /** Nothing is rendered when null. */
  message: string | null;
  onDismiss: () => void;
  duration?: number;
  /** Retour arrière proposé dans le message (ex. « Annuler ») ; le clic ferme aussi le message. */
  action?: { label: string; onClick: () => void };
  className?: string;
};

/** Transient confirmation. Auto-dismisses after `duration` ms (a bit longer when it offers an action). */
export function Toast({ message, onDismiss, duration, action, className }: ToastProps) {
  const delay = duration ?? (action ? 6500 : 3200);
  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(onDismiss, delay);
    return () => clearTimeout(timer);
  }, [message, delay, onDismiss]);

  if (message === null) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'surface-glass ui-rise inline-flex items-center gap-2.5 max-w-[460px] rounded-2xl px-4 py-3 text-[14px] font-semibold text-ink',
        className,
      )}
    >
      <Check className="size-[18px] shrink-0 text-trust" strokeWidth={2.6} aria-hidden="true" />
      {message}
      {action ? (
        <button
          type="button"
          className="-my-1 -mr-2 ml-1 shrink-0 cursor-pointer rounded-pill px-3 py-1 font-bold underline underline-offset-2 transition-colors duration-(--ui-dur-press) hover:bg-ink/10"
          onClick={() => {
            action.onClick();
            onDismiss();
          }}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
