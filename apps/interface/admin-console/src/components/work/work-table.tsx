'use client';

import { StatusPill, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@techma/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { AdminWorkItem } from '@/lib/department-api';
import { formatDateTime } from '@/lib/format';
import { formatRelative } from '@/lib/relative-time';
import { STATUS_LABELS, completedByLabel, isOverdue } from '@/lib/work-format';
import { SimulationPill } from './work-row';

type Mode = 'pending' | 'completed';

// Below md the table reads as stacked cards: headers hidden, each cell on its own line with an inline label.
const ROW = 'relative max-md:flex max-md:h-auto max-md:flex-col max-md:gap-2 max-md:py-4';
const CELL = 'py-3 align-top max-md:py-0';
const INLINE_LABEL = 'mr-1.5 text-[13px] text-ink-muted md:hidden';

function State({ item }: { item: AdminWorkItem }) {
  let pill: ReactNode;
  let detail: string | null = null;
  switch (item.status) {
    case 'submitted':
      pill = <StatusPill status="toValidate">Nouvelle demande</StatusPill>;
      detail = 'à vérifier';
      break;
    case 'processing':
      pill = <StatusPill status="info">En cours</StatusPill>;
      detail = item.assignedTo ? `pris en charge par ${item.assignedTo}` : null;
      break;
    case 'blocked':
      pill = <StatusPill status="danger">Bloqué</StatusPill>;
      detail = item.blocking?.detail ?? null;
      break;
    default:
      pill = <StatusPill status="info">{STATUS_LABELS[item.status]}</StatusPill>;
  }
  return (
    <span className="flex flex-col items-start gap-1">
      {pill}
      {detail ? <span className="text-[13px] text-ink-muted">{detail}</span> : null}
    </span>
  );
}

function When({ iso, label }: { iso: string; label: string }) {
  return (
    <span title={formatDateTime(iso)} className="whitespace-nowrap">
      <span className={INLINE_LABEL}>{label}</span>
      {formatRelative(iso)}
    </span>
  );
}

function Due({ item }: { item: AdminWorkItem }) {
  if (!item.dueAt) return <span className="text-ink-muted">-</span>;
  const late = isOverdue(item);
  return (
    <span className={late ? 'font-semibold text-danger' : undefined}>
      <span className={INLINE_LABEL}>Échéance</span>
      {late ? 'En retard · ' : null}
      <span className="whitespace-nowrap">{formatDateTime(item.dueAt)}</span>
    </span>
  );
}

/** Work queue as a table: one dossier per row, the title links to its detail (the whole row is the hit area). */
export function WorkTable({ items, mode, label }: { items: AdminWorkItem[]; mode: Mode; label: string }) {
  return (
    <Table aria-label={label} className="max-md:block [&_tbody]:max-md:block">
      <TableHead className="max-md:sr-only">
        <TableRow>
          <TableHeaderCell>Dossier</TableHeaderCell>
          <TableHeaderCell>{mode === 'pending' ? 'État' : 'Complété par'}</TableHeaderCell>
          <TableHeaderCell>{mode === 'pending' ? 'Reçu' : 'Complété le'}</TableHeaderCell>
          <TableHeaderCell>{mode === 'pending' ? 'Échéance' : 'Reçu'}</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {items.map((item, index) => {
          const received = item.submittedAt ?? item.createdAt;
          const completed = item.completedAt ?? item.updatedAt;
          return (
            <TableRow key={item.id} enterIndex={index} className={ROW}>
              <TableCell className={CELL}>
                <span className="flex flex-col items-start gap-1">
                  <Link
                    href={`/dossiers/${encodeURIComponent(item.id)}`}
                    // Stretched link: the row is clickable, the title stays the accessible name.
                    className="font-semibold text-ink after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-focus"
                  >
                    {item.title}
                  </Link>
                  <span className="flex flex-wrap items-center gap-2">
                    {item.receiptRef ? (
                      <span className="font-mono text-xs text-ink-muted">{item.receiptRef}</span>
                    ) : null}
                    {item.simulation ? <SimulationPill /> : null}
                  </span>
                </span>
              </TableCell>
              <TableCell className={CELL}>
                {mode === 'pending' ? (
                  <State item={item} />
                ) : (
                  <span className="font-medium">{completedByLabel(item) ?? 'Complété'}</span>
                )}
              </TableCell>
              <TableCell className={CELL}>
                {mode === 'pending' ? <When iso={received} label="Reçu" /> : <When iso={completed} label="Complété" />}
              </TableCell>
              <TableCell className={CELL}>
                {mode === 'pending' ? <Due item={item} /> : <When iso={received} label="Reçu" />}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
