'use client';

import { Inbox } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { AdministrationGate, Skeleton } from '@/components/admin/console/administration-gate';
import { useConsole } from '@/components/admin/console/console-context';
import { RequirePermission } from '@/components/admin/console/require-permission';
import { PageHeader } from '@/components/admin/page-header';
import { PagedFooter, usePagedList } from '@/components/admin/paginated-table';
import { adminApi, type CaseView } from '@/lib/admin/api';
import { EMPTY_CASE_FILTERS, STATUS_LABELS, matchesCaseFilters, tabFor, type CaseListFilters } from '@/lib/admin/work-format';
import { QueueFilter } from './queue-filter';
import { CaseQueue, QueueChipRow, QueueSearch } from './work-table';

const LIMIT = 20;

function List({ administrationId, view }: { administrationId: string | undefined; view: CaseView }) {
  const copy = tabFor(view)!;
  const { officialName } = useConsole();
  const [filters, setFilters] = useState<CaseListFilters>(EMPTY_CASE_FILTERS);
  const load = useCallback(
    (cursor: string | null) => adminApi.listCases({ administrationId, view, cursor, limit: LIMIT }),
    [administrationId, view],
  );
  const { items, nextCursor, status, error, retry, loadMore } = usePagedList(load);
  const firstLoad = status === 'loading' && items.length === 0;
  const visible = useMemo(() => items.filter((item) => matchesCaseFilters(item, filters)), [items, filters]);
  const statusChips = copy.statuses.length > 1;
  const [query, setQuery] = useState('');

  return (
    <>
      <PageHeader
        title={copy.title}
        description={copy.description}
        count={items.length > 0 ? visible.length : undefined}
        toolbar={
          items.length > 0 ? (
            <>
              <QueueSearch query={query} onQueryChange={setQuery} />
              <QueueFilter statuses={copy.statuses} filters={filters} onChange={setFilters} />
              {statusChips ? (
                <QueueChipRow
                  chips={[
                    {
                      key: 'all',
                      label: 'Tous',
                      active: filters.statuses.length === 0,
                      onClick: () => setFilters((prev) => ({ ...prev, statuses: [] })),
                    },
                    ...copy.statuses.map((itemStatus) => ({
                      key: itemStatus,
                      label: STATUS_LABELS[itemStatus],
                      active: filters.statuses.length === 1 && filters.statuses[0] === itemStatus,
                      onClick: () => setFilters((prev) => ({ ...prev, statuses: [itemStatus] })),
                    })),
                  ]}
                />
              ) : null}
            </>
          ) : null
        }
      />
      <div className="flex flex-col gap-4">
        {firstLoad ? <Skeleton lines={4} /> : null}
        {items.length > 0 ? (
          <CaseQueue items={visible} label={copy.title} officialName={officialName} query={query} />
        ) : null}
        {status === 'idle' && items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-tile bg-sunken px-6 py-14 text-ink-muted">
            <Inbox aria-hidden="true" className="size-10" />
            <p className="text-base font-semibold text-ink">{copy.empty}</p>
          </div>
        ) : null}
        <PagedFooter
          status={status}
          error={error}
          noun={copy.noun}
          hasMore={nextCursor !== null}
          onRetry={retry}
          onLoadMore={loadMore}
        />
      </div>
    </>
  );
}

/** One tab of the case queue: En attente (`pending`), Complété (`completed`) or Rejeté (`rejected`). */
export function WorkList({ view }: { view: Exclude<CaseView, 'all'> }) {
  const copy = tabFor(view)!;
  return (
    <RequirePermission permission="cases:read">
      <AdministrationGate header={<PageHeader title={copy.title} description={copy.description} />}>
        {(administrationId) => <List administrationId={administrationId} view={view} />}
      </AdministrationGate>
    </RequirePermission>
  );
}
