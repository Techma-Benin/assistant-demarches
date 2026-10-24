import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

export type BrandMarkProps = HTMLAttributes<HTMLSpanElement> & { size?: 'sm' | 'lg' };

export function BrandMark({ size = 'sm', className, ...props }: BrandMarkProps) {
  const large = size === 'lg';
  return (
    <span
      aria-hidden={props['aria-label'] ? undefined : true}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full bg-trust font-extrabold text-on-trust',
        large ? 'size-16 text-3xl' : 'size-8 text-base',
        className,
      )}
      {...props}
    >
      A
      <span
        className={cn(
          'absolute rounded-full bg-sun ring-2 ring-canvas',
          large ? 'top-0 right-0 size-4' : 'top-0 right-0 size-2.5',
        )}
      />
    </span>
  );
}
