'use client';

import { Check } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '../cn';

export type ToastProps = {
  /** Nothing is rendered when null. */
  message: string | null;
  onDismiss: () => void;
  duration?: number;
  className?: string;
};

/** Transient confirmation. Auto-dismisses after `duration` ms. */
export function Toast({ message, onDismiss, duration = 3200, className }: ToastProps) {
  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onDismiss]);

  if (message === null) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'ui-rise inline-flex items-center gap-2.5 max-w-[460px] rounded-2xl bg-action px-4 py-3 text-[14px] font-semibold text-on-action',
        className,
      )}
    >
      <Check className="size-[18px] shrink-0 text-trust" strokeWidth={2.6} aria-hidden="true" />
      {message}
    </div>
  );
}
