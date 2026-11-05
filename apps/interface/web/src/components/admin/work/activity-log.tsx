'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { AdministrationGate } from '@/components/admin/console/administration-gate';
import { useConsole } from '@/components/admin/console/console-context';
import { PaginatedTable, type Column } from '@/components/admin/paginated-table';
import { adminApi, type ActivityEntry } from '@/lib/admin/api';
import { badgeTone } from '@/lib/admin/badge-tone';
import { formatDateTime } from '@/lib/admin/format';
import { ACTIVITY_LABELS, activityActor } from '@/lib/admin/work-format';

const LIMIT = 20;

const journalDate = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Day, short month and year. The exact time stays on the cell title. */
function formatJournalDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : journalDate.format(date);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function Actor({ name, toneKey }: { name: string; toneKey: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tracking-wide ${badgeTone(toneKey)}`}
      >
        {initials(name)}
      </span>
      <span className="min-w-0 truncate" title={name}>
        {name}
      </span>
    </span>
  );
}

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
      className: 'w-[9.25rem] whitespace-nowrap align-top text-ink-muted',
      sortValue: (a) => a.at,
      cell: (a) => <span title={formatDateTime(a.at)}>{formatJournalDate(a.at)}</span>,
    },
    {
      header: 'Action',
      className: 'w-[15rem] whitespace-nowrap align-top',
      sortValue: (a) => ACTIVITY_LABELS[a.action],
      cell: (a) => <span className="font-semibold">{ACTIVITY_LABELS[a.action]}</span>,
    },
    {
      header: 'Acteur',
      className: 'w-[15rem] min-w-[15rem] whitespace-nowrap align-top',
      sortValue: (a) => activityActor(a, officialName),
      cell: (a) => {
        const name = activityActor(a, officialName);
        return <Actor name={name} toneKey={a.officialId ?? name} />;
      },
    },
    {
      header: 'Dossier',
      className: 'w-[14rem] min-w-[14rem] whitespace-nowrap align-top',
      sortValue: (a) => a.caseReference,
      cell: (a) =>
        canOpenCases ? (
          <Link
            href={`/admin/dossiers/${encodeURIComponent(a.caseId)}`}
            className="whitespace-nowrap font-mono text-[13px] underline"
          >
            {a.caseReference}
          </Link>
        ) : (
          <span className="whitespace-nowrap font-mono text-[13px]">{a.caseReference}</span>
        ),
    },
    {
      header: 'Note',
      className: 'w-[16rem] max-w-[16rem] align-top',
      sortValue: (a) => a.note ?? '',
      cell: (a) => (a.note ? <span className="line-clamp-2 break-words">{a.note}</span> : '-'),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PaginatedTable
        label="Journal"
        noun="le journal"
        columns={columns}
        rowKey={(a) => a.id}
        load={load}
        className="min-w-[69.25rem] table-fixed"
      />
      <p className="text-[13px] text-ink-subtle">Le journal ne contient aucun texte de conversation.</p>
    </div>
  );
}

export function ActivityLog() {
  return <AdministrationGate>{(administrationId) => <Log administrationId={administrationId} />}</AdministrationGate>;
}
