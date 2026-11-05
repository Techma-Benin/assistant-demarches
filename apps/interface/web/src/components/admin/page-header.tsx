import type { ReactNode } from 'react';

function SampleBadge() {
  if (process.env.NEXT_PUBLIC_SAMPLE_DATA !== 'true') return null;
  return (
    <span className="self-start rounded-pill bg-sunken px-2.5 py-1 text-xs font-bold text-ink">Données simulées</span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  count,
  toolbar,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Shown beside the title. Omit on pages that do not list a queue. */
  count?: number;
  /** Filters and search, on the same row as the title and outside any data card. */
  toolbar?: ReactNode;
}) {
  const heading = (
    <h1 className="flex flex-wrap items-center gap-3 font-display text-[clamp(36px,4.4vw,56px)] leading-[0.95] font-extrabold tracking-[-0.045em]">
      <span className="min-w-0 break-words">{title}</span>
      {count !== undefined ? (
        <span className="relative inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full bg-sunken px-2 text-sm leading-none font-semibold tracking-normal text-ink tabular-nums">
          <span className="sr-only"> </span>
          {count}
        </span>
      ) : null}
    </h1>
  );

  if (count === undefined && toolbar == null) {
    return (
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2.5">
          <SampleBadge />
          {heading}
          {description ? <p className="max-w-[620px] text-base text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
    );
  }

  return (
    <header className="mb-5 flex flex-col gap-2.5">
      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-2.5">
          <SampleBadge />
          {heading}
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
          {toolbar}
          {actions}
        </div>
      </div>
      {description ? <p className="max-w-[620px] text-base text-ink-muted">{description}</p> : null}
    </header>
  );
}
