'use client';

import { SegmentedControl, StatusPill, cn } from '@techma/ui';
import { Search, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { c3, type Procedure } from '@/lib/c3-client';
import {
  filterProcedures,
  formatSourceAge,
  isStaleSource,
  type StatusFilter,
} from '@/lib/procedure-list';
import { PagedFooter, usePagedList } from '../paginated-table';

const LIMIT = 20;
const loadProcedures = (cursor: string | null) => c3.listProcedures({ cursor, limit: LIMIT });

const STATUS_OPTIONS = [
  { value: 'all', label: 'Toutes' },
  { value: 'validated', label: 'Validées' },
  { value: 'draft', label: 'Brouillons' },
];

export interface ProcedureBrowserProps {
  /** From `?status=`. */
  initialStatus?: StatusFilter;
  /** From `?stale=1`: sources older than 90 days only. */
  initialStale?: boolean;
  /** Reference date for the age of the sources (tests). */
  now?: Date;
}

export function ProcedureBrowser({ initialStatus = 'all', initialStale = false, now }: ProcedureBrowserProps) {
  const [reference] = useState(() => now ?? new Date());
  const { items, nextCursor, status, error, retry, loadMore } = usePagedList(loadProcedures);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);
  const [stale, setStale] = useState(initialStale);

  const visible = useMemo(
    () => filterProcedures(items, { query, status: statusFilter, stale }, reference),
    [items, query, statusFilter, stale, reference],
  );
  const filtering = query.trim() !== '' || statusFilter !== 'all' || stale;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-[1_1_260px]">
          <label htmlFor="procedure-search" className="sr-only">
            Rechercher une fiche
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-subtle"
          />
          <input
            id="procedure-search"
            type="search"
            value={query}
            placeholder="Rechercher une fiche…"
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-12 w-full rounded-field border border-field bg-surface pr-4 pl-10 text-[15px] text-ink placeholder:text-ink-subtle"
          />
        </div>
        <SegmentedControl
          aria-label="Filtrer par statut"
          options={STATUS_OPTIONS}
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StatusFilter)}
        />
        {stale ? (
          <button
            type="button"
            onClick={() => setStale(false)}
            className="ui-press inline-flex min-h-11 items-center gap-2 rounded-pill bg-danger-soft px-4 text-[14px] font-semibold text-danger"
          >
            Source de plus de 90 jours
            <X aria-hidden="true" className="size-4" />
            <span className="sr-only">Retirer le filtre</span>
          </button>
        ) : null}
      </div>

      <p role="status" className="text-sm text-ink-muted">
        {status === 'loading' && items.length === 0
          ? 'Chargement…'
          : `${visible.length} fiche${visible.length > 1 ? 's' : ''}${filtering ? ` sur ${items.length} chargée${items.length > 1 ? 's' : ''}` : ''}`}
      </p>

      <ul aria-label="Fiches de démarche" aria-busy={status === 'loading'} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((procedure) => (
          <li key={procedure.id} className="min-w-0">
            <ProcedureCard procedure={procedure} now={reference} />
          </li>
        ))}
      </ul>

      {status === 'idle' && visible.length === 0 ? (
        <p className="rounded-card bg-sunken p-6 text-center text-ink-muted">
          {items.length === 0 ? 'Aucun élément à afficher.' : 'Aucune fiche chargée ne correspond à ces filtres.'}
        </p>
      ) : null}

      <PagedFooter
        status={status}
        error={error}
        noun="les fiches de démarche"
        hasMore={nextCursor !== null}
        onRetry={retry}
        onLoadMore={loadMore}
      />
    </div>
  );
}

function ProcedureCard({ procedure, now }: { procedure: Procedure; now: Date }) {
  const stale = isStaleSource(procedure.source.retrievedAt, now);
  const validated = procedure.validationStatus === 'validated';
  return (
    <Link
      href={`/procedures/${encodeURIComponent(procedure.id)}`}
      className="ui-press flex h-full min-h-11 flex-col gap-2.5 rounded-card border border-line bg-surface p-4 text-ink hover:bg-sunken"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-[15px] leading-snug font-bold">{procedure.title}</span>
        <StatusPill status={validated ? 'validated' : 'draft'} className="shrink-0">
          {validated ? 'Validée' : 'Brouillon'}
        </StatusPill>
      </span>
      <span className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-ink-subtle">
        <span className="font-mono break-all">{procedure.id}</span>
        <span className={cn(stale && 'font-bold text-danger')}>
          Source · {formatSourceAge(procedure.source.retrievedAt, now)}
        </span>
      </span>
    </Link>
  );
}
