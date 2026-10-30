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
} from '@techma/ui';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FORBIDDEN, isForbidden } from '@/lib/error-messages';
import { C3Error } from '@/lib/c3-client';

export interface Column<T> {
  header: string;
  cell: (item: T) => ReactNode;
  className?: string;
}

export interface PagedPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PaginatedTableProps<T> {
  /** Accessible name of the table. */
  label: string;
  /** Plural noun used in messages, e.g. « les modèles ». */
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

export function errorMessage(error: unknown, noun: string): string {
  if (isForbidden(error)) return FORBIDDEN;
  if (error instanceof C3Error && (error.status === 401 || error.status === 403)) {
    return 'Accès administrateur requis';
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

  const visible = filter ? items.filter(filter) : items;
  const firstLoad = items.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <Table aria-label={label} aria-busy={status === 'loading'} className={className}>
        <TableHead className="bg-shell">
          <TableRow className="border-line-subtle">
            {columns.map((column) => (
              <TableHeaderCell key={column.header}>{column.header}</TableHeaderCell>
            ))}
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
