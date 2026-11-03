'use client';

import { Button, InlineAlert, SegmentedControl, StatusPill, Toast } from '@techma/ui';
import { Inbox } from 'lucide-react';
import { useCallback, useState } from 'react';
import { AdministrationGate, Skeleton } from '@/components/admin/console/administration-gate';
import { PageHeader } from '@/components/admin/page-header';
import { PagedFooter, usePagedList } from '@/components/admin/paginated-table';
import { useToast } from '@/components/admin/use-toast';
import { adminApi, type UnansweredEntry } from '@/lib/admin/api';
import { toFailure } from '@/lib/admin/errors';
import { formatDateTime } from '@/lib/admin/format';
import { formatRelative } from '@/lib/admin/relative-time';
import { UNANSWERED_REASONS } from '@/lib/admin/work-format';

const LIMIT = 20;
const FILTERS = [
  { value: 'open', label: 'Ouvertes' },
  { value: 'resolved', label: 'Résolues' },
];

function Entries({ administrationId }: { administrationId: string | undefined }) {
  const [filter, setFilter] = useState<'open' | 'resolved'>('open');
  const load = useCallback(
    (cursor: string | null) => adminApi.listUnanswered({ administrationId, status: filter, cursor, limit: LIMIT }),
    [administrationId, filter],
  );
  const { items, nextCursor, status, error, retry, loadMore } = usePagedList(load);
  const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const toast = useToast();

  async function resolve(entry: UnansweredEntry) {
    setSending(entry.id);
    setFailure(null);
    try {
      await adminApi.resolveUnanswered(entry.id);
      setResolved((previous) => new Set(previous).add(entry.id));
      toast.show('Question marquée comme résolue.');
    } catch (caught) {
      setFailure(toFailure(caught).message);
    } finally {
      setSending(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Sans réponse"
        description="Les questions auxquelles l’assistant n’a pas su répondre. Seuls le thème et le motif sont affichés, jamais le texte de la question."
        actions={<Toast message={toast.message} onDismiss={toast.dismiss} />}
      />
      <div className="flex flex-col gap-4">
        <SegmentedControl
          aria-label="Filtrer les questions"
          options={FILTERS}
          value={filter}
          onValueChange={(value) => setFilter(value as 'open' | 'resolved')}
        />
        {status === 'loading' && items.length === 0 ? <Skeleton lines={4} /> : null}
        {failure ? <InlineAlert>{failure}</InlineAlert> : null}
        {items.length > 0 ? (
          <ul aria-label="Questions sans réponse" className="m-0 flex list-none flex-col p-0">
            {items.map((entry) => {
              const done = entry.status === 'resolved' || resolved.has(entry.id);
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-4 border-b border-line-subtle py-4 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <p className="text-base text-ink">
                      <strong className="font-bold">{entry.theme ?? 'Thème non déterminé'}</strong>
                      {` · ${UNANSWERED_REASONS[entry.reason]}`}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-muted">
                      <StatusPill status={done ? 'validated' : 'toValidate'} className="px-2.5 py-1 text-xs">
                        {done ? 'Résolue' : 'Ouverte'}
                      </StatusPill>
                      <span title={formatDateTime(entry.createdAt)}>{formatRelative(entry.createdAt)}</span>
                    </p>
                  </div>
                  {done ? null : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={sending !== null}
                      onClick={() => void resolve(entry)}
                    >
                      Marquer comme résolu
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
        {status === 'idle' && items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-tile bg-sunken px-6 py-14 text-ink-muted">
            <Inbox aria-hidden="true" className="size-10" />
            <p className="text-base font-semibold text-ink">
              {filter === 'open' ? 'Aucune question sans réponse' : 'Aucune question résolue'}
            </p>
          </div>
        ) : null}
        <PagedFooter
          status={status}
          error={error}
          noun="les questions sans réponse"
          hasMore={nextCursor !== null}
          onRetry={retry}
          onLoadMore={loadMore}
        />
      </div>
    </>
  );
}

export function UnansweredList() {
  return (
    <AdministrationGate header={<PageHeader title="Sans réponse" />}>
      {(administrationId) => <Entries administrationId={administrationId} />}
    </AdministrationGate>
  );
}
