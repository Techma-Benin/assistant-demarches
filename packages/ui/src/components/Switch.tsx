import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'children'> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Visible label; without it, pass `aria-label`. */
  children?: ReactNode;
  /** Couleur de l’état activé : confiance (vert) ou encre (mandat). */
  tone?: 'trust' | 'ink';
};

/** Binary toggle (button with role="switch"). On = trust (or ink), off = border-strong with a white thumb. */
export function Switch({ checked, onCheckedChange, tone = 'trust', className, type, children, disabled, onClick, ...props }: SwitchProps) {
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
          'relative inline-flex h-[30px] w-[52px] shrink-0 items-center rounded-pill transition-colors duration-150 ease-[ease]',
          checked ? (tone === 'ink' ? 'bg-action' : 'bg-trust') : 'bg-[var(--ui-border-strong)]',
        )}
      >
        <span
          className={cn(
            'absolute left-[3px] size-6 rounded-pill shadow-sm transition-transform duration-(--ui-dur-base) ease-(--ui-ease-out) group-enabled:group-active:scale-[0.92]',
            // Ink track turns white in dark mode: the thumb then takes the on-action colour.
            checked ? cn('translate-x-[22px]', tone === 'ink' ? 'bg-on-action' : 'bg-white') : 'translate-x-0 bg-white',
          )}
        />
      </span>
      {children}
    </button>
  );
}
