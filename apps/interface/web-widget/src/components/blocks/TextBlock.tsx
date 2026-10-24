import { Badge } from '@techma/ui';
import { BadgeCheck, ExternalLink } from 'lucide-react';
import type { components } from '@techma/contracts-ts';
import { formatDateFr, safeHttpUrl } from '@/lib/safe-url';

type Block = components['schemas']['Block'];
type Props = { block: Extract<Block, { type: 'text' }> };

export function TextBlock({ block }: Props) {
  return (
    <div>
      <p className="whitespace-pre-wrap break-words text-base">{block.text}</p>
      {block.sources.length > 0 && (
        <ul aria-label="Sources" className="mt-3 space-y-2 border-t border-line pt-3">
          {block.sources.map((source, index) => {
            const url = safeHttpUrl(source.url);
            const meta = `version ${source.version} · consultée le ${formatDateFr(source.retrievedAt)}`;
            return (
              <li key={`${source.url}-${index}`} className="flex flex-col items-start gap-1">
                <Badge tone="trust" icon={<BadgeCheck aria-hidden="true" className="size-4 shrink-0" />} className="max-w-full">
                  {url ? (
                    <a
                      href={url.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-w-0 items-center gap-1 underline underline-offset-2"
                    >
                      <span className="truncate">Source : {url.hostname}</span>
                      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                    </a>
                  ) : (
                    <span className="truncate">Source : {source.url}</span>
                  )}
                </Badge>
                <span className="text-[13px] text-ink-subtle">{meta}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
