import { Check } from 'lucide-react';
import { cn } from '../cn';
import { VisuallyHidden } from './VisuallyHidden';

export type Step = { label: string; status: 'done' | 'current' | 'todo'; description?: string };

const statusText = { done: 'terminé', current: 'en cours', todo: 'à venir' } as const;

/** Vertical procedure progress: done (check), current (ring), todo (grey ring). */
export function StepTracker({ steps, className }: { steps: Step[]; className?: string }) {
  return (
    <ol className={cn('m-0 flex list-none flex-col gap-1 p-0', className)}>
      {steps.map((step) => (
        <li
          key={step.label}
          aria-current={step.status === 'current' ? 'step' : undefined}
          className="flex items-center gap-3.5 py-2.5"
        >
          <span
            aria-hidden="true"
            className={cn(
              'inline-flex size-7 shrink-0 items-center justify-center rounded-pill',
              step.status === 'done' && 'bg-trust text-on-trust',
              step.status === 'current' && 'border-[2.5px] border-ink bg-surface',
              step.status === 'todo' && 'border-2 border-line-strong bg-surface',
            )}
          >
            {step.status === 'done' && <Check className="size-[13px]" strokeWidth={3.6} />}
          </span>
          <span className="flex flex-col gap-0.5">
            <span className={cn('text-[15px]', step.status === 'todo' ? 'text-ink-muted' : 'text-ink', step.status === 'current' ? 'font-extrabold' : 'font-semibold')}>
              {step.label}
              <VisuallyHidden> ({statusText[step.status]})</VisuallyHidden>
            </span>
            {step.description && <span className="text-[13px] text-ink-muted">{step.description}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
