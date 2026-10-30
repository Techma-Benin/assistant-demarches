import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2.5">
        {process.env.NEXT_PUBLIC_SAMPLE_DATA === 'true' ? (
          <span className="self-start rounded-pill bg-sunken px-2.5 py-1 text-xs font-bold text-ink">
            Données simulées
          </span>
        ) : null}
        <h1 className="font-display text-[clamp(36px,4.4vw,56px)] leading-[0.95] font-extrabold tracking-[-0.045em] break-words">
          {title}
        </h1>
        {description ? <p className="max-w-[620px] text-base text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}
