'use client';

import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, cn } from '@techma/ui';
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Case } from '@/lib/admin/api';
import { formatDateTime } from '@/lib/admin/format';
import { formatRelative } from '@/lib/admin/relative-time';
import { CHANNEL_LABELS, STATUS_LABELS, completedByLabel } from '@/lib/admin/work-format';
import { CaseReference, CaseStatusPill, ChannelPill } from './work-row';

const ROW = 'relative max-md:flex max-md:h-auto max-md:flex-col max-md:gap-2 max-md:py-4';
const CELL = 'py-3.5 align-top max-md:py-0';
const INLINE_LABEL = 'mr-1.5 text-[13px] text-ink-muted md:hidden';

export type SortKey = 'title' | 'channel' | 'status' | 'createdAt' | 'updatedAt';
export type SortDir = 'asc' | 'desc';

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'title', label: 'Dossier' },
  { key: 'channel', label: 'Canal' },
  { key: 'status', label: 'Statut' },
  { key: 'createdAt', label: 'Reçu' },
  { key: 'updatedAt', label: 'Mis à jour' },
];

export function sortCases(items: readonly Case[], key: SortKey, dir: SortDir): Case[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    if (left < right) return -1 * sign;
    if (left > right) return 1 * sign;
    return 0;
  });
}

function sortValue(item: Case, key: SortKey): string {
  if (key === 'title') return item.title.toLocaleLowerCase('fr');
  if (key === 'channel') return (CHANNEL_LABELS[item.channel] ?? item.channel).toLocaleLowerCase('fr');
  if (key === 'status') return STATUS_LABELS[item.status].toLocaleLowerCase('fr');
  return item[key];
}

export function matchesQuery(item: Case, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('fr');
  if (!needle) return true;
  const haystack = [
    item.title,
    item.reference,
    CHANNEL_LABELS[item.channel] ?? item.channel,
    STATUS_LABELS[item.status],
  ]
    .join(' ')
    .toLocaleLowerCase('fr');
  return haystack.includes(needle);
}

function When({ iso, label }: { iso: string; label: string }) {
  return (
    <span title={formatDateTime(iso)} className="whitespace-nowrap text-ink-subtle">
      <span className={INLINE_LABEL}>{label}</span>
      {formatRelative(iso)}
    </span>
  );
}

function assigneeLabel(item: Case, officialName: (id: string) => string): string | null {
  if (item.claimedBy) return officialName(item.claimedBy);
  return completedByLabel(item);
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown aria-hidden="true" className="size-3.5 text-ink-subtle" />;
  return dir === 'asc' ? (
    <ArrowUp aria-hidden="true" className="size-3.5 text-ink" />
  ) : (
    <ArrowDown aria-hidden="true" className="size-3.5 text-ink" />
  );
}

function SortHeader({
  label,
  column,
  active,
  dir,
  onSort,
}: {
  label: string;
  column: SortKey;
  active: boolean;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <TableHeaderCell aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium transition-colors duration-(--ui-dur-press) ease-(--ui-ease-out) hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
          active ? 'text-ink' : 'text-ink-muted',
        )}
      >
        {label}
        <SortIcon active={active} dir={dir} />
      </button>
    </TableHeaderCell>
  );
}

/** Case queue as a table: one dossier per row, the title links to its detail (the whole row is the hit area). */
export function WorkTable({
  items,
  label,
  officialName,
  query = '',
}: {
  items: Case[];
  label: string;
  officialName: (id: string) => string;
  query?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function onSort(key: SortKey) {
    if (key === sortKey) setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'title' || key === 'channel' || key === 'status' ? 'asc' : 'desc');
    }
  }

  const rows = useMemo(() => {
    const visible = query.trim() ? items.filter((item) => matchesQuery(item, query)) : items;
    return sortCases(visible, sortKey, sortDir);
  }, [items, query, sortKey, sortDir]);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-[13px] font-medium text-ink-muted md:hidden">
        Trier
        <select
          value={`${sortKey}:${sortDir}`}
          onChange={(event) => {
            const [key, dir] = event.target.value.split(':') as [SortKey, SortDir];
            setSortKey(key);
            setSortDir(dir);
          }}
          className="min-h-10 flex-1 rounded-field border border-line bg-surface px-3 text-sm text-ink"
        >
          {COLUMNS.flatMap(({ key, label: column }) => {
            const dated = key === 'createdAt' || key === 'updatedAt';
            return [
              <option key={`${key}-desc`} value={`${key}:desc`}>
                {dated ? `${column}, plus récent` : `${column}, Z → A`}
              </option>,
              <option key={`${key}-asc`} value={`${key}:asc`}>
                {dated ? `${column}, plus ancien` : `${column}, A → Z`}
              </option>,
            ];
          })}
        </select>
      </label>
      <Table aria-label={label} className="max-md:block [&_tbody]:max-md:block" wrapperClassName="rounded-none border-0">
        <TableHead className="max-md:sr-only">
          <TableRow className="border-line-subtle">
            {COLUMNS.slice(0, 3).map(({ key, label: column }) => (
              <SortHeader key={key} label={column} column={key} active={sortKey === key} dir={sortDir} onSort={onSort} />
            ))}
            <TableHeaderCell>
              <span className="text-[13px] font-medium text-ink-muted">Pris en charge</span>
            </TableHeaderCell>
            {COLUMNS.slice(3).map(({ key, label: column }) => (
              <SortHeader key={key} label={column} column={key} active={sortKey === key} dir={sortDir} onSort={onSort} />
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((item, index) => {
            const assignee = assigneeLabel(item, officialName);
            return (
              <TableRow key={item.id} enterIndex={index} className={ROW}>
                <TableCell className={CELL}>
                  <span className="flex flex-col items-start gap-1">
                    <Link
                      href={`/admin/dossiers/${encodeURIComponent(item.id)}`}
                      className="font-semibold text-ink after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-focus"
                    >
                      {item.title}
                    </Link>
                    <CaseReference item={item} mark={false} />
                  </span>
                </TableCell>
                <TableCell className={CELL}>
                  <span className={INLINE_LABEL}>Canal</span>
                  <ChannelPill channel={item.channel} />
                </TableCell>
                <TableCell className={CELL}>
                  <CaseStatusPill status={item.status} />
                </TableCell>
                <TableCell className={CELL}>
                  <span className={INLINE_LABEL}>Pris en charge</span>
                  {assignee ? <span className="text-ink">{assignee}</span> : null}
                </TableCell>
                <TableCell className={CELL}>
                  <When iso={item.createdAt} label="Reçu" />
                </TableCell>
                <TableCell className={CELL}>
                  <When iso={item.updatedAt} label="Mis à jour" />
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={COLUMNS.length + 1} className="py-10 text-center text-ink-muted">
                Aucun dossier ne correspond.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}

/** Icon that reveals the dossier search. The open field grows left; chips to its right stay put. */
export function QueueSearch({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const empty = query.trim() === '';

  function dismiss() {
    if (empty) setOpen(false);
    else onQueryChange('');
  }

  return (
    <div className={cn('flex min-w-0 items-center justify-end', open ? 'flex-1' : 'w-9 shrink-0')}>
      {open ? (
        <div
          role="search"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            dismiss();
          }}
          className="flex h-10 w-full min-w-0 items-center gap-2 rounded-pill border border-line-subtle bg-canvas px-3"
        >
          <Search aria-hidden="true" className="size-4 shrink-0 text-web" />
          <label className="sr-only" htmlFor={inputId}>
            Rechercher un dossier
          </label>
          <input
            id={inputId}
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Rechercher…"
            className="w-full min-w-0 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-ink-subtle"
          />
          <button
            type="button"
            aria-label="Effacer la recherche"
            onClick={dismiss}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-pill text-ink-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          aria-label="Rechercher un dossier"
          onClick={() => setOpen(true)}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-pill text-ink-muted transition-colors duration-(--ui-dur-press) ease-(--ui-ease-out) hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <Search aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}

/** Table card only. Title, count, filters and search live outside this card. */
export function CaseQueue({
  items,
  label,
  officialName,
  query = '',
}: {
  items: Case[];
  label: string;
  officialName: (id: string) => string;
  query?: string;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface">
      <WorkTable items={items} label={label} officialName={officialName} query={query} />
    </section>
  );
}

export type QueueChipItem = {
  key: string;
  label: string;
  active: boolean;
  onClick: () => void;
};

type ChipFrame = { x: number; y: number; width: number; height: number };

function sameFrame(a: ChipFrame | null, b: ChipFrame | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Status chips with one sliding highlight. The pill measures the active chip and translates. */
export function QueueChipRow({ chips }: { chips: readonly QueueChipItem[] }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<ChipFrame | null>(null);
  const signature = chips.map((chip) => `${chip.key}:${chip.active}:${chip.label}`).join('|');

  const measure = useCallback(() => {
    const row = rowRef.current;
    const active = row?.querySelector<HTMLElement>('[data-queue-chip][aria-pressed="true"]');
    if (!row || !active) {
      setFrame((prev) => (prev === null ? prev : null));
      return;
    }
    const rowRect = row.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    const next = {
      x: Math.round(rect.left - rowRect.left),
      y: Math.round(rect.top - rowRect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    setFrame((prev) => (sameFrame(prev, next) ? prev : next));
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, signature]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure, signature]);

  return (
    <div ref={rowRef} className="relative flex shrink-0 flex-wrap gap-1">
      {frame ? (
        <span
          aria-hidden="true"
          data-chip-indicator=""
          className="pointer-events-none absolute top-0 left-0 z-0 rounded-pill bg-action transition-[transform,width,height] duration-[220ms] ease-(--ui-ease-drawer) motion-reduce:transition-none"
          style={{ width: frame.width, height: frame.height, transform: `translate(${frame.x}px, ${frame.y}px)` }}
        />
      ) : null}
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          data-queue-chip=""
          aria-pressed={chip.active}
          onClick={chip.onClick}
          className={cn(
            'relative z-10 inline-flex min-h-8 items-center gap-1.5 rounded-pill px-3 text-[13px] font-medium transition-colors duration-(--ui-dur-press) ease-(--ui-ease-out) active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
            chip.active ? 'text-on-action' : 'text-ink-subtle hover:bg-sunken hover:text-ink',
          )}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
