import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

export const cardVariants = cva('rounded-card border p-4', {
  variants: {
    tone: {
      default: 'bg-surface border-line text-ink',
      trust: 'bg-trust-soft border-trust-line text-ink',
      warning: 'bg-warning-soft border-warning/30 text-ink',
      danger: 'bg-danger-soft border-danger/30 text-ink',
    },
  },
  defaultVariants: { tone: 'default' },
});

export type CardProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>;

export function Card({ tone, className, ...props }: CardProps) {
  return <div className={cn(cardVariants({ tone }), className)} {...props} />;
}
