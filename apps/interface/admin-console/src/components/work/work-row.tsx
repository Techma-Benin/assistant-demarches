'use client';

import { Badge, StatusPill } from '@techma/ui';
import Link from 'next/link';
import type { AdminWorkItem } from '@/lib/department-api';
import { formatDateTime } from '@/lib/format';
import { formatRelative } from '@/lib/relative-time';
import { completedByLabel, isOverdue, statePhrase } from '@/lib/work-format';

export function SimulationPill() {
  return (
    <StatusPill status="info" className="px-2.5 py-1 text-xs">
      Simulation
    </StatusPill>
  );
}

/** « Titre · phrase d’état » then received date, receipt, simulation and due hints. */
export function WorkRow({ item, mode }: { item: AdminWorkItem; mode: 'pending' | 'completed' }) {
  const phrase = mode === 'completed' ? (completedByLabel(item) ?? 'complété') : statePhrase(item);
  const when = mode === 'completed' ? (item.completedAt ?? item.updatedAt) : (item.submittedAt ?? item.createdAt);
  const overdue = mode === 'pending' && isOverdue(item);
  return (
    <li className="border-b border-line-subtle last:border-b-0">
      <Link
        href={`/dossiers/${encodeURIComponent(item.id)}`}
        className="flex flex-col gap-1.5 px-1 py-4 transition-colors hover:bg-sunken"
      >
        <p className="text-base text-ink">
          <strong className="font-bold">{item.title}</strong>
          {` · ${phrase}`}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-muted">
          <span title={formatDateTime(when)}>
            {mode === 'completed' ? 'Complété ' : 'Reçu '}
            {formatRelative(when)}
          </span>
          {item.receiptRef ? <span className="font-mono">{item.receiptRef}</span> : null}
          {item.simulation ? <SimulationPill /> : null}
          {overdue ? (
            <Badge tone="danger">En retard · échéance {formatDateTime(item.dueAt!)}</Badge>
          ) : mode === 'pending' && item.dueAt ? (
            <span>Échéance {formatDateTime(item.dueAt)}</span>
          ) : null}
        </p>
      </Link>
    </li>
  );
}
