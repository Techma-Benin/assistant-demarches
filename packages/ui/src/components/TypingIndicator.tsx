import type { HTMLAttributes } from 'react';
import { cn } from '../cn';
import { VisuallyHidden } from './VisuallyHidden';

export type TypingIndicatorProps = HTMLAttributes<HTMLSpanElement> & { label?: string };

// Vert, jaune, rouge : les couleurs du drapeau.
const DOTS = ['bg-trust', 'bg-sun', 'bg-flag-red'] as const;

export function TypingIndicator({ label = 'L’assistant écrit…', className, ...props }: TypingIndicatorProps) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-1.5 py-1', className)} {...props}>
      {DOTS.map((color, index) => (
        <span
          key={color}
          aria-hidden="true"
          style={{ animationDelay: `${index * 160}ms` }}
          className={cn(
            'size-2.5 rounded-full motion-safe:animate-[ui-typing-flag_1.2s_var(--ui-ease-out)_infinite]',
            color,
          )}
        />
      ))}
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
