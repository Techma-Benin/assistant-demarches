import { ArrowDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@techma/ui';

export function Bridge({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex justify-center', className)}>
      <a
        href={`#${to}`}
        className="group inline-flex min-h-11 items-center gap-2 rounded-pill px-4 text-[16px] font-medium text-current no-underline opacity-75 transition-opacity duration-200 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {children}
        <ArrowDown aria-hidden="true" className="size-4 animate-[bridge-nudge_1.8s_ease-in-out_infinite]" />
      </a>
    </div>
  );
}
