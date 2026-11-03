import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export const iconButtonVariants = cva(
  'inline-flex size-11 shrink-0 items-center justify-center rounded-pill ui-press transition-[color,background-color,border-color,transform] duration-(--ui-dur-press) ease-(--ui-ease-out) disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-action text-on-action hover:bg-action-hover',
        secondary: 'bg-surface border border-line-strong text-ink hover:bg-sunken',
        ghost: 'text-ink hover:bg-sunken',
      },
    },
    defaultVariants: { variant: 'ghost' },
  },
);

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> &
  VariantProps<typeof iconButtonVariants> & {
    label: string;
    children: ReactNode;
  };

export function IconButton({ label, variant, className, type, children, ...props }: IconButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      aria-label={label}
      className={cn(iconButtonVariants({ variant }), className)}
      {...props}
    >
      {children}
    </button>
  );
}
