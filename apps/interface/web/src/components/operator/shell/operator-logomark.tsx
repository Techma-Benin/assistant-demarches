import { cn } from '@techma/ui';
import type { SVGAttributes } from 'react';

/** Marque compacte console opérateur — distincte du buste StatusGraph. */
export function OperatorLogomark({ className, ...props }: SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn('size-8 shrink-0', className)}
      {...props}
    >
      <rect x="1" y="1" width="30" height="30" rx="9" className="fill-sunken stroke-line-subtle" strokeWidth="1" />
      <path
        d="M9 11h14v2.5H9V11Zm0 5.25h10v2.5H9v-2.5Zm0 5.25h14v2.5H9v-2.5Z"
        className="fill-ink"
      />
      <path
        d="M22.5 21.5 26 18l1.25 1.25-3.5 3.5-1.75-1.75.75-.75Z"
        className="fill-trust"
      />
      <circle cx="24.5" cy="19.5" r="2.25" className="stroke-trust" strokeWidth="1.25" fill="none" />
    </svg>
  );
}
