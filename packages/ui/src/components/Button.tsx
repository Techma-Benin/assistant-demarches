import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-pill whitespace-nowrap ui-press transition-[color,background-color,border-color,transform] duration-(--ui-dur-press) ease-(--ui-ease-out) disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-action text-on-action hover:bg-action-hover',
        secondary: 'bg-sunken text-ink hover:bg-line',
        outline: 'border border-action bg-transparent text-ink hover:bg-sunken',
        /** Uniquement pour « Valider et publier ». */
        trust: 'bg-trust text-on-trust hover:brightness-95',
        ghost: 'text-ink hover:bg-sunken',
      },
      size: {
        lg: 'min-h-14 px-8 text-base font-semibold',
        md: 'min-h-12 px-6 text-[15px] font-semibold',
        sm: 'min-h-9 px-4 text-sm font-semibold',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    leadingIcon?: ReactNode;
    trailingIcon?: ReactNode;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  leadingIcon,
  trailingIcon,
  type,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    // Slot requires a single child: icons go inside the child element.
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button type={type ?? 'button'} className={classes} {...props}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
}
