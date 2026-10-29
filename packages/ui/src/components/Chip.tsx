import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

export type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean };

export function Chip({ selected = false, className, type, ...props }: ChipProps) {
  return (
    <button
      type={type ?? 'button'}
      aria-pressed={selected}
      className={cn(
        'inline-flex min-h-11 items-center justify-center rounded-pill px-[18px] py-3 text-[15px] font-medium ui-press transition-[color,background-color,border-color,transform] duration-(--ui-dur-press) ease-(--ui-ease-out) disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'bg-action text-on-action'
          : 'bg-sunken text-ink hover:bg-line',
        className,
      )}
      {...props}
    />
  );
}
