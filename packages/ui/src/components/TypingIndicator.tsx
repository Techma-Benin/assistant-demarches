import type { HTMLAttributes } from 'react';
import { cn } from '../cn';
import { VisuallyHidden } from './VisuallyHidden';

export type TypingIndicatorProps = HTMLAttributes<HTMLSpanElement> & { label?: string };

export function TypingIndicator({ label = 'L’assistant écrit…', className, ...props }: TypingIndicatorProps) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-1 py-1', className)} {...props}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          aria-hidden="true"
          style={{ animationDelay: `${index * 150}ms` }}
          className="size-2 rounded-full bg-ink-subtle motion-safe:animate-[ui-typing_1s_var(--ui-ease-out)_infinite]"
        />
      ))}
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
