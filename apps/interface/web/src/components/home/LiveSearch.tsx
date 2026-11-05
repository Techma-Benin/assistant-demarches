'use client';

import { ArrowUpRight } from 'lucide-react';
import { cn } from '@techma/ui';
import { CATALOGUE } from './CatalogueSection';

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase();

const ENTRIES = CATALOGUE.flatMap((theme) =>
  theme.items.map((item) => ({ ...item, theme: theme.title, haystack: fold(`${item.name} ${theme.title} ${item.about}`) })),
);

export function matchDemarches(query: string, limit = 5) {
  const words = fold(query)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !['comment', 'obtenir', 'mon', 'une', 'un', 'le', 'la', 'les', 'de', 'des', 'du', 'pour'].includes(w));
  if (words.length === 0) return [];
  return ENTRIES.filter((entry) => words.every((w) => entry.haystack.includes(w))).slice(0, limit);
}

export function LiveSearch({ query, disabled, onPick }: { query: string; disabled?: boolean; onPick: (question: string) => void }) {
  const results = query.trim().length >= 2 ? matchDemarches(query) : [];
  if (results.length === 0) return null;
  return (
    <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-[22px] border border-line bg-surface text-left shadow-[0_18px_50px_rgb(0_0_0/0.18)] animate-[ui-enter_180ms_ease-out_both]">
      <p className="m-0 px-5 pb-1 pt-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">Démarches correspondantes</p>
      <ul aria-label="Démarches correspondantes" className="m-0 list-none p-1.5">
        {results.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.name}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(item.question)}
                className={cn(
                  'group flex min-h-12 w-full items-center gap-3 rounded-[16px] px-3.5 py-2 text-left hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-trust-soft text-trust-text">
                  <Icon className="size-[18px]" strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[16px] font-semibold text-ink">{item.name}</span>
                  <span className="truncate text-[14px] text-ink-muted">{item.theme}</span>
                </span>
                <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted group-hover:text-ink" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
