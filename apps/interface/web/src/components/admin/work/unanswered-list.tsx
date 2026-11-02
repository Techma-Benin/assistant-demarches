'use client';

import { Button, InlineAlert, StatusPill, Toast } from '@techma/ui';
import { Inbox } from 'lucide-react';
import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/admin/page-header';
import { PagedFooter, usePagedList } from '@/components/admin/paginated-table';
import { useToast } from '@/components/admin/use-toast';
import { departmentApi, type UnansweredEntry } from '@/lib/admin/department-api';
import { formatDateTime } from '@/lib/admin/format';
import { formatRelative } from '@/lib/admin/relative-time';
import { toActionFailure } from '@/lib/admin/work-errors';
import { DepartmentGate, Skeleton } from './department-gate';

const LIMIT = 20;
const mono = 'font-mono text-[13px]';

function Entries({ departmentId }: { departmentId: string | undefined }) {
  const load = useCallback(
    (cursor: string | null) => departmentApi.listUnanswered({ departmentId, cursor, limit: LIMIT }),
    [departmentId],
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
      await departmentApi.resolveUnanswered(entry.id, `resolve-${entry.id}-${crypto.randomUUID()}`);
      setResolved((previous) => new Set(previous).add(entry.id));
      toast.show('Question marquée comme résolue.');
    } catch (caught) {
      setFailure(toActionFailure(caught).message);
    } finally {
      setSending(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Sans réponse"
        description="Les questions auxquelles l’assistant n’a pas su répondre. Seuls les identifiants sont affichés, jamais le texte de la conversation."
        actions={<Toast message={toast.message} onDismiss={toast.dismiss} />}
      />
      <div className="flex flex-col gap-4">
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
                      <strong className="font-bold">{entry.reason}</strong>
                    </p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-muted">
                      <StatusPill status={done ? 'validated' : 'toValidate'} className="px-2.5 py-1 text-xs">
                        {done ? 'Résolu' : 'Ouvert'}
                      </StatusPill>
                      <span title={formatDateTime(entry.createdAt)}>{formatRelative(entry.createdAt)}</span>
                      <span className={mono}>{entry.conversationId}</span>
                      <span className={mono}>{entry.messageId}</span>
                    </p>
                  </div>
                  {done ? null : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={sending !== null}
                      onClick={() => void resolve(entry)}
                    >
                      Marquer résolu
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
            <p className="text-base font-semibold text-ink">Aucune question sans réponse</p>
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
    <DepartmentGate header={<PageHeader title="Sans réponse" />}>
      {(departmentId) => <Entries departmentId={departmentId} />}
    </DepartmentGate>
  );
}
