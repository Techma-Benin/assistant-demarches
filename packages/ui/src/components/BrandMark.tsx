import type { HTMLAttributes } from 'react';
import { cn } from '../cn';
import { FlagGlyph } from './FlagGlyph';

export type BrandMarkProps = HTMLAttributes<HTMLSpanElement> & {
  size?: 'sm' | 'lg';
  /** false : mot-symbole seul (repli si l’équipe refuse le drapeau dans la marque). */
  showFlag?: boolean;
};

export function BrandMark({ size = 'sm', showFlag = true, className, ...props }: BrandMarkProps) {
  const large = size === 'lg';
  return (
    <span
      className={cn('inline-flex shrink-0 items-center', large ? 'gap-3' : 'gap-2.5', className)}
      {...props}
    >
      {showFlag ? (
        <FlagGlyph decorative width={large ? 48 : 30} height={large ? 35 : 22} className="shrink-0" />
      ) : null}
      <span
        className={cn(
          'font-display font-extrabold tracking-[-0.02em] text-ink',
          large ? 'text-[32px] leading-none' : 'text-[19px] leading-none',
        )}
      >
        Démarches
      </span>
    </span>
  );
}
