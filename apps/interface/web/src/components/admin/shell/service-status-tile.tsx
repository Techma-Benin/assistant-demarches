import { cn } from '@techma/ui';

export type BackendState = 'checking' | 'up' | 'down';

/** Reduced « État du service »: whether the Backend answered the profile request. */
export function ServiceStatusTile({ state }: { state: BackendState }) {
  return (
    <section aria-label="État du service" className="rounded-card border border-line-subtle bg-surface p-3.5">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <span
          aria-hidden="true"
          className={cn('size-2 shrink-0 rounded-full', state === 'checking' ? 'bg-line-strong' : state === 'up' ? 'bg-trust' : 'bg-flag-red')}
        />
        {state === 'checking' ? 'Backend : vérification…' : state === 'up' ? 'Backend joignable' : 'Backend injoignable'}
      </p>
    </section>
  );
}
