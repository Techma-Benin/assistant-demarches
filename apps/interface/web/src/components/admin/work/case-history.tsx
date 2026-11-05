'use client';

import { useCallback } from 'react';
import { useConsole } from '@/components/admin/console/console-context';
import { adminApi } from '@/lib/admin/api';
import { formatDateTime } from '@/lib/admin/format';
import { ACTIVITY_LABELS, activityActor } from '@/lib/admin/work-format';
import { useRemote } from '@/lib/admin/work-remote';
import { Skeleton } from '@/components/admin/console/administration-gate';
import { RemoteError } from './remote-error';

/** Journal of one case (`GET /activity?caseId=`), reloaded when `version` changes (after an action). */
export function CaseHistory({
  caseId,
  administrationId,
  version,
}: {
  caseId: string;
  administrationId: string;
  version: string;
}) {
  const { officialName } = useConsole();
  const load = useCallback(
    () => adminApi.listActivity({ caseId, administrationId, limit: 100 }),
    // `version` re-runs the load once the case changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caseId, administrationId, version],
  );
  const { data, status, error, reload } = useRemote(load);
  return (
    <section aria-label="Historique du dossier" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
      <h2 className="text-[17px] leading-tight font-semibold tracking-[-0.02em] text-ink">Historique</h2>
      {status === 'loading' && !data ? <Skeleton lines={2} /> : null}
      {status === 'error' ? <RemoteError error={error} noun="l’historique" onRetry={reload} /> : null}
      {data && data.items.length === 0 ? <p className="text-ink-muted">Aucune entrée.</p> : null}
      {data && data.items.length > 0 ? (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {data.items.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-0.5 border-t border-line-subtle pt-3">
              <p className="text-base text-ink">
                <strong className="font-semibold">{ACTIVITY_LABELS[entry.action]}</strong>
                <span className="ml-2 text-[13px] text-ink-muted">{activityActor(entry, officialName)}</span>
              </p>
              <p className="text-[13px] text-ink-muted">{formatDateTime(entry.at)}</p>
              {entry.note ? <p className="text-[13px] text-ink-muted">{entry.note}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
