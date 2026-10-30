import type { ReactNode } from 'react';
import { cn } from '../cn';

export type CounterProps = {
  value: ReactNode;
  label: string;
  caption?: string;
  tone?: 'default' | 'trust' | 'danger';
  className?: string;
};

const tones = { default: 'text-ink', trust: 'text-trust-text', danger: 'text-danger' } as const;

/** Big figure with label and caption. Renders as a `<dl>` item: label then value. */
export function Counter({ value, label, caption, tone = 'default', className }: CounterProps) {
  return (
    <div className={cn('flex flex-col gap-2.5 border-t border-line pb-2 pr-6 pt-8', className)}>
      <dt className="order-2 max-w-60 text-[17px] font-medium text-ink">{label}</dt>
      <dd className="contents">
        <span
          className={cn(
            'order-1 block font-display text-[clamp(64px,7vw,104px)] whitespace-nowrap font-extrabold leading-[0.9] tracking-[-0.06em]',
            tones[tone],
          )}
        >
          {value}
        </span>
        {caption && <span className="order-3 block text-[14px] text-ink-muted">{caption}</span>}
      </dd>
    </div>
  );
}

/** Responsive grid of `Counter`s (1 → 2 → 4 columns). */
export function CounterGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('m-0 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4', className)}>{children}</dl>;
}
