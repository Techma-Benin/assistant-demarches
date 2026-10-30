import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

export const tileVariants = cva('rounded-tile p-7 md:p-11', {
  variants: {
    tone: {
      default: 'bg-sunken text-ink',
      ink: 'bg-action text-on-action',
      // Le jaune ne sert qu’en fond : jamais text-sun. text-warning = encre fixe (lisible aussi en sombre).
      sun: 'bg-sun text-warning',
      trust: 'bg-trust text-on-trust',
      outline: 'border border-line bg-surface text-ink',
      white: 'bg-surface text-ink',
    },
  },
  defaultVariants: { tone: 'default' },
});

export type TileProps = HTMLAttributes<HTMLElement> &
  VariantProps<typeof tileVariants> & { asChild?: boolean };

/** Grande tuile arrondie (accueil, console). `asChild` pour rendre un autre élément (lien, section…). */
export function Tile({ tone, asChild = false, className, ...props }: TileProps) {
  const Comp = asChild ? Slot : 'div';
  return <Comp className={cn(tileVariants({ tone }), className)} {...props} />;
}
