'use client';

import {
  Button,
  InlineAlert,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  cn,
} from '@techma/ui';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AdminError } from '@/lib/admin/errors';

export interface Column<T> {
  header: string;
  cell: (item: T) => ReactNode;
  /** Layout classes for the column: applied to the header and the cell. */
  className?: string;
  /**
   * Comparable value for client-side sorting of the rows already loaded.
   * Omit it when the column has nothing to sort (the header stays plain text).
   */
  sortValue?: (item: T) => string | number | null | undefined;
}

export interface PagedPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PaginatedTableProps<T> {
  /** Accessible name of the table. */
  label: string;
  /** Plural noun used in messages, e.g. « les agents ». */
  noun: string;
  columns: ReadonlyArray<Column<T>>;
  rowKey: (item: T) => string;
  load: (cursor: string | null) => Promise<PagedPage<T>>;
  /** Client-side filter over the loaded rows (the cursor pagination is unaffected). */
  filter?: (item: T) => boolean;
  /** Called with every loaded row whenever the list grows. */
  onItemsChange?: (items: T[]) => void;
  /** Extra classes of the `<table>` (e.g. a min-width inside the horizontal scroller). */
  className?: string;
}

type Status = 'loading' | 'idle' | 'error';
type SortDir = 'asc' | 'desc';

function compareSortValues(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left ?? '').localeCompare(String(right ?? ''), 'fr', { numeric: true, sensitivity: 'base' });
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown aria-hidden="true" className="size-3.5 text-ink-subtle" />;
  return dir === 'asc' ? (
    <ArrowUp aria-hidden="true" className="size-3.5 text-ink" />
  ) : (
    <ArrowDown aria-hidden="true" className="size-3.5 text-ink" />
  );
}

export function errorMessage(error: unknown, noun: string): string {
  if (error instanceof AdminError && (error.status === 401 || error.status === 403)) {
    return 'Vous n’avez pas accès à cette page.';
  }
  return `Impossible de charger ${noun}.`;
}

/** Cursor-paginated list state shared by the tables and the card lists (same retry / load-more semantics). */
export function usePagedList<T>(load: (cursor: string | null) => Promise<PagedPage<T>>) {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<unknown>(null);
  const cursorRef = useRef<string | null>(null); // cursor of the page being (re)tried
  const generation = useRef(0);
  const countRef = useRef(0); // rows currently loaded
  const [batchStart, setBatchStart] = useState(0); // index of the first row of the latest batch

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const current = ++generation.current;
      cursorRef.current = cursor;
      setStatus('loading');
      try {
        const page = await load(cursor);
        if (current !== generation.current) return;
        setBatchStart(cursor === null ? 0 : countRef.current);
        setItems((previous) => (cursor === null ? page.items : [...previous, ...page.items]));
        setNextCursor(page.nextCursor);
        setStatus('idle');
      } catch (caught) {
        if (current !== generation.current) return;
        setError(caught);
        setStatus('error');
      }
    },
    [load],
  );

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void fetchPage(null);
    return () => {
      generation.current += 1;
    };
  }, [fetchPage]);

  countRef.current = items.length;
  const retry = useCallback(() => void fetchPage(cursorRef.current), [fetchPage]);
  const loadMore = useCallback(() => void fetchPage(nextCursor), [fetchPage, nextCursor]);

  const reload = useCallback(() => void fetchPage(null), [fetchPage]);

  return { items, nextCursor, status, error, batchStart, retry, loadMore, reload };
}

/** Error + « Réessayer », and « Charger plus » while a next cursor exists. */
export function PagedFooter({
  status,
  error,
  noun,
  hasMore,
  onRetry,
  onLoadMore,
}: {
  status: Status;
  error: unknown;
  noun: string;
  hasMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  return (
    <>
      {status === 'error' ? (
        <div className="flex flex-wrap items-center gap-3">
          <InlineAlert>{errorMessage(error, noun)}</InlineAlert>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Réessayer
          </Button>
        </div>
      ) : null}

      {status !== 'error' && hasMore ? (
        <div className="flex">
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11 min-w-36"
            disabled={status === 'loading'}
            onClick={onLoadMore}
          >
            <span key={status === 'loading' ? 'loading' : 'idle'} className="ui-swap">
              {status === 'loading' ? 'Chargement…' : 'Charger plus'}
            </span>
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function PaginatedTable<T>({
  label,
  noun,
  columns,
  rowKey,
  load,
  filter,
  onItemsChange,
  className,
}: PaginatedTableProps<T>) {
  const { items, nextCursor, status, error, batchStart, retry, loadMore } = usePagedList(load);

  const changed = useRef(onItemsChange);
  changed.current = onItemsChange;
  useEffect(() => {
    changed.current?.(items);
  }, [items]);

  const [sort, setSort] = useState<{ header: string; dir: SortDir } | null>(null);
  const onSort = useCallback((header: string) => {
    setSort((current) =>
      current?.header === header ? { header, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { header, dir: 'asc' },
    );
  }, []);

  const visible = useMemo(() => {
    const filtered = filter ? items.filter(filter) : items;
    const column = sort ? columns.find((candidate) => candidate.header === sort.header) : undefined;
    if (!sort || !column?.sortValue) return filtered;
    const sign = sort.dir === 'asc' ? 1 : -1;
    const valueOf = column.sortValue;
    return [...filtered].sort((a, b) => sign * compareSortValues(valueOf(a), valueOf(b)));
  }, [columns, filter, items, sort]);
  const firstLoad = items.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <Table aria-label={label} aria-busy={status === 'loading'} className={className}>
        <TableHead className="bg-shell">
          <TableRow className="border-line-subtle">
            {columns.map((column) =>
              column.sortValue ? (
                <TableHeaderCell
                  key={column.header}
                  aria-sort={sort?.header === column.header ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={column.className}
                >
                  <button
                    type="button"
                    onClick={() => onSort(column.header)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium transition-colors duration-(--ui-dur-press) ease-(--ui-ease-out) hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
                      sort?.header === column.header ? 'text-ink' : 'text-ink-muted',
                    )}
                  >
                    {column.header}
                    <SortIcon active={sort?.header === column.header} dir={sort?.dir ?? 'asc'} />
                  </button>
                </TableHeaderCell>
              ) : (
                <TableHeaderCell key={column.header} className={column.className}>
                  {column.header}
                </TableHeaderCell>
              ),
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {visible.map((item) => (
            <TableRow
              key={rowKey(item)}
              className="border-line-subtle"
              enterIndex={Math.max(0, items.indexOf(item) - batchStart)}
            >
              {columns.map((column) => (
                <TableCell key={column.header} className={column.className}>
                  {column.cell(item)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {status === 'loading' && firstLoad
            ? Array.from({ length: 5 }, (_, row) => (
                <TableRow key={`skeleton-${row}`} aria-hidden="true">
                  {columns.map((column) => (
                    <TableCell key={column.header}>
                      <span className="block h-4 w-3/4 animate-pulse rounded-pill bg-sunken" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : null}
          {status === 'idle' && visible.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-ink-muted">
                {firstLoad ? 'Aucun élément à afficher.' : 'Aucun élément chargé ne correspond à ce filtre.'}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <PagedFooter
        status={status}
        error={error}
        noun={noun}
        hasMore={nextCursor !== null}
        onRetry={retry}
        onLoadMore={loadMore}
      />
    </div>
  );
}
