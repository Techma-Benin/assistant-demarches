'use client';

import { Inbox } from 'lucide-react';
import { useCallback } from 'react';
import { PageHeader } from '@/components/page-header';
import { PagedFooter, usePagedList } from '@/components/paginated-table';
import { departmentApi } from '@/lib/department-api';
import { DepartmentGate, Skeleton } from './department-gate';
import { WorkTable } from './work-table';

const LIMIT = 20;

const COPY = {
  pending: {
    title: 'En attente',
    noun: 'les dossiers en attente',
    description: 'Les dossiers déposés par les usagers qui attendent une vérification de votre équipe.',
    empty: 'Aucun dossier',
  },
  completed: {
    title: 'Complété',
    noun: 'les dossiers complétés',
    description: 'Les dossiers terminés, par l’IA ou par un agent.',
    empty: 'Aucun dossier complété',
  },
} as const;

function List({ departmentId, mode }: { departmentId: string | undefined; mode: 'pending' | 'completed' }) {
  const copy = COPY[mode];
  const load = useCallback(
    (cursor: string | null) => departmentApi.listWorkItems({ departmentId, status: mode, cursor, limit: LIMIT }),
    [departmentId, mode],
  );
  const { items, nextCursor, status, error, retry, loadMore } = usePagedList(load);
  const title = mode === 'pending' && status === 'idle' ? `${copy.title} (${items.length})` : copy.title;
  const firstLoad = status === 'loading' && items.length === 0;

  return (
    <>
      <PageHeader title={title} description={copy.description} />
      <div className="flex flex-col gap-4">
        {firstLoad ? <Skeleton lines={4} /> : null}
        {items.length > 0 ? (
          <WorkTable items={items} mode={mode} label={copy.title} />
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

export function WorkList({ mode }: { mode: 'pending' | 'completed' }) {
  return (
    <DepartmentGate header={<PageHeader title={COPY[mode].title} description={COPY[mode].description} />}>
      {(departmentId) => <List departmentId={departmentId} mode={mode} />}
    </DepartmentGate>
  );
}
