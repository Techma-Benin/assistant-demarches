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
import { C3Error } from '@/lib/c3-client';

export interface Column<T> {
  header: string;
  cell: (item: T) => ReactNode;
  className?: string;
}

export interface PaginatedTableProps<T> {
  /** Accessible name of the table. */
  label: string;
  /** Plural noun used in messages, e.g. « les modèles ». */
  noun: string;
  columns: ReadonlyArray<Column<T>>;
  rowKey: (item: T) => string;
  load: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>;
}

type Status = 'loading' | 'idle' | 'error';

export function errorMessage(error: unknown, noun: string): string {
  if (error instanceof C3Error && (error.status === 401 || error.status === 403)) {
    return 'Accès administrateur requis';
  }
  return `Impossible de charger ${noun}.`;
}

export function PaginatedTable<T>({ label, noun, columns, rowKey, load }: PaginatedTableProps<T>) {
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
  const firstLoad = items.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <Table aria-label={label} aria-busy={status === 'loading'}>
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableHeaderCell key={column.header}>{column.header}</TableHeaderCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item, index) => (
            <TableRow key={rowKey(item)} enterIndex={Math.max(0, index - batchStart)}>
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
          {status === 'idle' && firstLoad ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-8 text-center text-ink-muted">
                Aucun élément à afficher.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {status === 'error' ? (
        <div className="flex flex-wrap items-center gap-3">
          <InlineAlert>{errorMessage(error, noun)}</InlineAlert>
          <Button variant="secondary" size="sm" onClick={() => void fetchPage(cursorRef.current)}>
            Réessayer
          </Button>
        </div>
      ) : null}

      {status !== 'error' && nextCursor !== null ? (
        <div className="flex">
          <Button
            variant="secondary"
            size="sm"
            className="min-w-36"
            disabled={status === 'loading'}
            onClick={() => void fetchPage(nextCursor)}
          >
            <span key={status === 'loading' ? 'loading' : 'idle'} className="ui-swap">
              {status === 'loading' ? 'Chargement…' : 'Charger plus'}
            </span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
