import { FlagGlyph, cn } from '@techma/ui';
import type { ComponentProps } from 'react';

/** Same flag glyph as `BrandMark` in citizen/admin headers (~28px rail). */
export function OperatorLogomark({ className, ...props }: Omit<ComponentProps<typeof FlagGlyph>, 'decorative'>) {
  return <FlagGlyph decorative width={28} height={21} className={cn('shrink-0', className)} {...props} />;
}
