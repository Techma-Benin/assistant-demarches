'use client';

import { IconButton, SegmentedControl, cn } from '@techma/ui';
import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { c3, type AuditEntry } from '@/lib/c3-client';
import { auditKind, availableAuditFilters, matchesAuditFilter, type AuditFilter } from '@/lib/audit-filter';
import { formatDateTime, shorten } from '@/lib/format';
import { formatRelative } from '@/lib/relative-time';
import { PaginatedTable, type Column } from '../paginated-table';

const LIMIT = 20;
const mono = 'font-mono text-[13px]';
const loadAudit = (cursor: string | null) => c3.listAudit({ cursor, limit: LIMIT });

const FILTER_LABELS: Record<AuditFilter, string> = {
  all: 'Tout',
  configuration: 'Configuration',
  mcp: 'MCP',
  deleted: 'Suppressions',
};

const PILL_TONES = {
  configuration: 'bg-sunken text-ink',
  deleted: 'bg-danger-soft text-danger',
  mcp: 'bg-[#EEF0FF] text-[#2A3390]',
} as const;

function CopyTrace({ traceId }: { traceId: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn(mono, 'text-ink-subtle')} title={traceId}>
        {shorten(traceId, 12)}
      </span>
      <IconButton
        label={copied ? 'Trace copiée' : `Copier la trace ${traceId}`}
        onClick={() => {
          void navigator.clipboard?.writeText(traceId).then(() => setCopied(true));
        }}
      >
        {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
      </IconButton>
    </span>
  );
}

export function AuditLog({ now }: { now?: Date }) {
  const [reference] = useState(() => now ?? new Date());
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState<AuditFilter>('all');

  const filters = availableAuditFilters(entries);
  // A filter that no longer matches anything (never the case once shown, but be safe) falls back to « Tout ».
  const current = filters.includes(filter) ? filter : 'all';

  const columns: Column<AuditEntry>[] = [
    {
      header: 'Quand',
      className: 'whitespace-nowrap text-ink-muted',
      cell: (a) => <span title={formatDateTime(a.at)}>{formatRelative(a.at, reference)}</span>,
    },
    {
      header: 'Action',
      cell: (a) => (
        <span
          className={cn(
            'inline-block rounded-pill px-2.5 py-1 font-mono text-xs font-semibold whitespace-nowrap',
            PILL_TONES[auditKind(a.action)],
          )}
        >
          {a.action}
        </span>
      ),
    },
    { header: 'Ressource', cell: (a) => <span className={mono}>{a.resourceId}</span> },
    { header: 'Acteur', cell: (a) => <span className={mono}>{a.actorRef}</span> },
    { header: 'Trace', cell: (a) => <CopyTrace traceId={a.traceId} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        aria-label="Filtrer le journal"
        className="self-start"
        options={filters.map((value) => ({ value, label: FILTER_LABELS[value] }))}
        value={current}
        onValueChange={(value) => setFilter(value as AuditFilter)}
      />
      <PaginatedTable
        label="Journal d’audit"
        noun="le journal d’audit"
        columns={columns}
        rowKey={(a) => a.id}
        load={loadAudit}
        filter={(a) => matchesAuditFilter(a, current)}
        onItemsChange={setEntries}
        className="min-w-[820px]"
      />
      <p className="text-[13px] text-ink-subtle">
        Le journal ne contient ni contenu de configuration ni secret.
      </p>
    </div>
  );
}
