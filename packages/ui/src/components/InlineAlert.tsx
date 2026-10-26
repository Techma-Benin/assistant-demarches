import { CircleAlert, TriangleAlert } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

export type InlineAlertProps = HTMLAttributes<HTMLDivElement> & { tone?: 'danger' | 'warning' };

export function InlineAlert({ tone = 'danger', className, children, ...props }: InlineAlertProps) {
  const Icon = tone === 'danger' ? CircleAlert : TriangleAlert;
  return (
    <div
      role="alert"
      className={cn(
        'ui-rise flex items-start gap-2 rounded-field px-3 py-2 text-sm font-semibold',
        tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning',
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}
