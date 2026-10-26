import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'children'> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Visible label; without it, pass `aria-label`. */
  children?: ReactNode;
};

/** Binary toggle (button with role="switch"). On = action, off = sunken with border. */
export function Switch({ checked, onCheckedChange, className, type, children, disabled, onClick, ...props }: SwitchProps) {
  return (
    <button
      type={type ?? 'button'}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange?.(!checked);
      }}
      className={cn(
        'group inline-flex min-h-11 items-center gap-3 text-[15px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill border transition-colors duration-150 ease-[ease]',
          checked ? 'border-action bg-action' : 'border-line-strong bg-sunken',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 size-4.5 rounded-pill transition-transform duration-(--ui-dur-base) ease-(--ui-ease-out) group-enabled:group-active:scale-[0.92]',
            checked ? 'translate-x-5 bg-on-action' : 'translate-x-0 bg-ink-muted',
          )}
        />
      </span>
      {children}
    </button>
  );
}
