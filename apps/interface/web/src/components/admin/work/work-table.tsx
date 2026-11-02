'use client';

import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@techma/ui';
import Link from 'next/link';
import type { Case } from '@/lib/admin/api';
import { formatDateTime } from '@/lib/admin/format';
import { formatRelative } from '@/lib/admin/relative-time';
import { CHANNEL_LABELS, completedByLabel } from '@/lib/admin/work-format';
import { CaseReference, CaseStatusPill } from './work-row';

// Below md the table reads as stacked cards: headers hidden, each cell on its own line with an inline label.
const ROW = 'relative max-md:flex max-md:h-auto max-md:flex-col max-md:gap-2 max-md:py-4';
const CELL = 'py-3 align-top max-md:py-0';
const INLINE_LABEL = 'mr-1.5 text-[13px] text-ink-muted md:hidden';

function When({ iso, label }: { iso: string; label: string }) {
  return (
    <span title={formatDateTime(iso)} className="whitespace-nowrap">
      <span className={INLINE_LABEL}>{label}</span>
      {formatRelative(iso)}
    </span>
  );
}

/** Case queue as a table: one dossier per row, the title links to its detail (the whole row is the hit area). */
export function WorkTable({
  items,
  label,
  officialName,
}: {
  items: Case[];
  label: string;
  officialName: (id: string) => string;
}) {
  return (
    <Table aria-label={label} className="max-md:block [&_tbody]:max-md:block">
      <TableHead className="max-md:sr-only">
        <TableRow>
          <TableHeaderCell>Dossier</TableHeaderCell>
          <TableHeaderCell>Canal</TableHeaderCell>
          <TableHeaderCell>Statut</TableHeaderCell>
          <TableHeaderCell>Reçu</TableHeaderCell>
          <TableHeaderCell>Mis à jour</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {items.map((item, index) => {
          const done = item.status === 'completed' ? completedByLabel(item) : null;
          return (
            <TableRow key={item.id} enterIndex={index} className={ROW}>
              <TableCell className={CELL}>
                <span className="flex flex-col items-start gap-1">
                  <Link
                    href={`/admin/dossiers/${encodeURIComponent(item.id)}`}
                    // Stretched link: the row is clickable, the title stays the accessible name.
                    className="font-semibold text-ink after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-focus"
                  >
                    {item.title}
                  </Link>
                  <CaseReference item={item} />
                </span>
              </TableCell>
              <TableCell className={CELL}>
                <span className={INLINE_LABEL}>Canal</span>
                {CHANNEL_LABELS[item.channel] ?? item.channel}
              </TableCell>
              <TableCell className={CELL}>
                <span className="flex flex-col items-start gap-1">
                  <CaseStatusPill status={item.status} />
                  {done ? <span className="text-[13px] text-ink-muted">{done}</span> : null}
                  {item.claimedBy && item.status === 'in_review' ? (
                    <span className="text-[13px] text-ink-muted">pris en charge par {officialName(item.claimedBy)}</span>
                  ) : null}
                </span>
              </TableCell>
              <TableCell className={CELL}>
                <When iso={item.createdAt} label="Reçu" />
              </TableCell>
              <TableCell className={CELL}>
                <When iso={item.updatedAt} label="Mis à jour" />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
