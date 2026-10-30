import { ExternalLink } from 'lucide-react';
import { cn } from '../cn';
import { VisuallyHidden } from './VisuallyHidden';

export type SourceInfo = {
  index: number;
  title: string;
  domain: string;
  href?: string;
  version?: string;
  retrievedAtLabel?: string;
};

/** Superscript citation number inside an answer. */
export function CitationMark({ index, className }: { index: number; className?: string }) {
  return (
    <sup
      aria-label={`Source ${index}`}
      className={cn(
        'ml-[3px] inline-flex min-w-[1.4em] items-center justify-center rounded-[6px] bg-sunken px-[7px] py-px text-xs font-bold leading-[1.5] text-ink',
        className,
      )}
    >
      {index}
    </sup>
  );
}

const NewTab = () => <VisuallyHidden> (nouvel onglet)</VisuallyHidden>;

/** Compact pill: numbered dot + `title · domain`. A link when `href` is given. */
export function SourcePill({ index, title, domain, href, className }: SourceInfo & { className?: string }) {
  const classes = cn(
    'inline-flex min-h-11 items-center gap-2.5 rounded-pill border border-line bg-surface py-2.5 pl-2.5 pr-4 text-[14px] font-semibold text-ink',
    href && 'ui-press hover:bg-sunken',
    className,
  );
  const content = (
    <>
      <span
        aria-hidden="true"
        className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-pill bg-action text-xs font-bold text-on-action"
      >
        {index}
      </span>
      <span>
        {title} <span className="text-ink-muted">· {domain}</span>
      </span>
    </>
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
      {content}
      <NewTab />
    </a>
  ) : (
    <span className={classes}>{content}</span>
  );
}

/** Ordered list of sources for a side panel. */
export function SourceList({ sources, className }: { sources: SourceInfo[]; className?: string }) {
  return (
    <ol className={cn('flex flex-col gap-3', className)}>
      {sources.map((s) => (
        <li key={s.index} className="flex gap-3.5 rounded-card border border-line bg-surface p-4">
          <span
            aria-hidden="true"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-action text-[13px] font-bold text-on-action"
          >
            {s.index}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold text-ink">{s.title}</p>
            <p className="text-[13px] text-ink-muted">
              {s.domain}
              {s.version && ` · ${s.version}`}
            </p>
            {s.retrievedAtLabel && <p className="text-[13px] text-ink-muted">{s.retrievedAtLabel}</p>}
            {s.href && (
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-[14px] font-semibold text-trust-text underline"
              >
                Ouvrir la source
                <ExternalLink className="size-4" aria-hidden="true" />
                <NewTab />
              </a>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
