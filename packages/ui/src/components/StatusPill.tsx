import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export const statusPillVariants = cva(
  'inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-semibold leading-none',
  {
    variants: {
      status: {
        validated: 'bg-trust-soft text-trust-text',
        draft: 'bg-sun text-warning',
        toValidate: 'bg-sun text-warning',
        submitted: 'bg-trust text-on-trust',
        info: 'border border-line bg-surface text-ink',
        danger: 'bg-danger-soft text-danger',
      },
    },
    defaultVariants: { status: 'info' },
  },
);

export type StatusPillProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof statusPillVariants> & { icon?: ReactNode };

export function StatusPill({ status, icon, className, children, ...props }: StatusPillProps) {
  return (
    <span className={cn(statusPillVariants({ status }), className)} {...props}>
      {icon}
      {children}
    </span>
  );
}
