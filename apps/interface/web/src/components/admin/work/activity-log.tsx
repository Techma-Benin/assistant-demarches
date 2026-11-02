'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { AdministrationGate } from '@/components/admin/console/administration-gate';
import { useConsole } from '@/components/admin/console/console-context';
import { PaginatedTable, type Column } from '@/components/admin/paginated-table';
import { adminApi, type ActivityEntry } from '@/lib/admin/api';
import { formatDateTime } from '@/lib/admin/format';
import { formatRelative } from '@/lib/admin/relative-time';
import { ACTIVITY_LABELS, activityActor } from '@/lib/admin/work-format';

const LIMIT = 20;

function Log({ administrationId }: { administrationId: string | undefined }) {
  const { officialName, can } = useConsole();
  const load = useCallback(
    (cursor: string | null) => adminApi.listActivity({ administrationId, cursor, limit: LIMIT }),
    [administrationId],
  );
  const canOpenCases = can('cases:read');
  const columns: Column<ActivityEntry>[] = [
    {
      header: 'Quand',
      className: 'whitespace-nowrap text-ink-muted',
      cell: (a) => <span title={formatDateTime(a.at)}>{formatRelative(a.at)}</span>,
    },
    { header: 'Action', cell: (a) => <span className="font-semibold">{ACTIVITY_LABELS[a.action]}</span> },
    { header: 'Acteur', cell: (a) => activityActor(a, officialName) },
    {
      header: 'Dossier',
      cell: (a) =>
        canOpenCases ? (
          <Link href={`/admin/dossiers/${encodeURIComponent(a.caseId)}`} className="font-mono text-[13px] underline">
            {a.caseReference}
          </Link>
        ) : (
          <span className="font-mono text-[13px]">{a.caseReference}</span>
        ),
    },
    { header: 'Note', cell: (a) => a.note ?? '-' },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PaginatedTable
        label="Journal"
        noun="le journal"
        columns={columns}
        rowKey={(a) => a.id}
        load={load}
        className="min-w-[760px]"
      />
      <p className="text-[13px] text-ink-subtle">Le journal ne contient aucun texte de conversation.</p>
    </div>
  );
}

export function ActivityLog() {
  return <AdministrationGate>{(administrationId) => <Log administrationId={administrationId} />}</AdministrationGate>;
}
