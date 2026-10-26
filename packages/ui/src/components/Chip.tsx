import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

export type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean };

export function Chip({ selected = false, className, type, ...props }: ChipProps) {
  return (
    <button
      type={type ?? 'button'}
      aria-pressed={selected}
      className={cn(
        'inline-flex min-h-10 items-center justify-center rounded-pill border px-4 text-[15px] font-semibold ui-press transition-[color,background-color,border-color,transform] duration-(--ui-dur-press) ease-(--ui-ease-out) disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-action bg-action text-on-action'
          : 'border-line-strong bg-surface text-ink hover:bg-sunken',
        className,
      )}
      {...props}
    />
  );
}
