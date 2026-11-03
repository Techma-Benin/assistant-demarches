'use client';

import { StatusPill } from '@techma/ui';
import Link from 'next/link';
import type { Case, CaseStatus } from '@/lib/admin/api';
import { formatDateTime } from '@/lib/admin/format';
import { formatRelative } from '@/lib/admin/relative-time';
import { CHANNEL_LABELS, STATUS_LABELS, completedByLabel } from '@/lib/admin/work-format';

export function SimulationPill() {
  return (
    <StatusPill status="info" className="px-2.5 py-1 text-xs">
      Simulation
    </StatusPill>
  );
}

export function statusTone(status: CaseStatus) {
  switch (status) {
    case 'completed':
      return 'validated' as const;
    case 'rejected':
      return 'danger' as const;
    case 'received':
    case 'information_requested':
      return 'toValidate' as const;
    case 'awaiting_payment':
      return 'draft' as const;
    default:
      return 'info' as const;
  }
}

export function CaseStatusPill({ status }: { status: CaseStatus }) {
  return <StatusPill status={statusTone(status)}>{STATUS_LABELS[status]}</StatusPill>;
}

/** Reference (SIM-…) with the « Simulation » mark when the case is simulated. */
export function CaseReference({ item }: { item: Pick<Case, 'reference' | 'simulated'> }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-xs text-ink-muted">{item.reference}</span>
      {item.simulated ? <SimulationPill /> : null}
    </span>
  );
}

/** Compact row of the overview: « Titre · statut », then the reference and the last update. */
export function CaseRow({ item }: { item: Case }) {
  const done = item.status === 'completed' ? completedByLabel(item) : null;
  return (
    <li className="border-b border-line-subtle last:border-b-0">
      <Link
        href={`/admin/dossiers/${encodeURIComponent(item.id)}`}
        className="flex flex-col gap-1.5 px-1 py-4 transition-colors hover:bg-sunken"
      >
        <p className="text-base text-ink">
          <strong className="font-bold">{item.title}</strong>
          {` · ${STATUS_LABELS[item.status].toLowerCase()}${done ? ` ${done}` : ''}`}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-muted">
          <span title={formatDateTime(item.updatedAt)}>Mis à jour {formatRelative(item.updatedAt)}</span>
          <span>{CHANNEL_LABELS[item.channel] ?? item.channel}</span>
          <CaseReference item={item} />
        </p>
      </Link>
    </li>
  );
}
