import type { components } from '@techma/contracts-ts';
import { formatDateFr, safeHttpUrl } from '@/lib/safe-url';

type Block = components['schemas']['Block'];
type Props = { block: Extract<Block, { type: 'text' }> };

export function TextBlock({ block }: Props) {
  return (
    <div>
      <p className="whitespace-pre-wrap break-words">{block.text}</p>
      {block.sources.length > 0 && (
        <div className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-600">
          <p className="font-semibold">Sources</p>
          <ul className="mt-1 space-y-1">
            {block.sources.map((source, index) => {
              const url = safeHttpUrl(source.url);
              const meta = `version ${source.version}, consultée le ${formatDateFr(source.retrievedAt)}`;
              return (
                <li key={`${source.url}-${index}`}>
                  {url ? (
                    <a
                      href={url.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 underline"
                    >
                      {url.hostname}
                    </a>
                  ) : (
                    <span>{source.url}</span>
                  )}
                  {' — '}
                  {meta}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
