'use client';

import { IconButton, Toast, cn } from '@techma/ui';
import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PaginatedTable, type Column } from '@/components/paginated-table';
import { useToast } from '@/components/use-toast';
import { departmentApi, type ActivityEntry } from '@/lib/department-api';
import { formatDateTime, shorten } from '@/lib/format';
import { formatRelative } from '@/lib/relative-time';
import { DepartmentGate } from './department-gate';

const LIMIT = 20;
const mono = 'font-mono text-[13px]';

function CopyTrace({ traceId, onCopied }: { traceId: string; onCopied: () => void }) {
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
        label={`Copier la trace ${traceId}`}
        onClick={() => {
          void navigator.clipboard?.writeText(traceId).then(() => {
            setCopied(true);
            onCopied();
          });
        }}
      >
        {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
      </IconButton>
    </span>
  );
}

function Log({ departmentId }: { departmentId: string | undefined }) {
  const toast = useToast();
  const load = useCallback(
    (cursor: string | null) => departmentApi.listActivity({ departmentId, cursor, limit: LIMIT }),
    [departmentId],
  );
  const columns: Column<ActivityEntry>[] = [
    {
      header: 'Quand',
      className: 'whitespace-nowrap text-ink-muted',
      cell: (a) => <span title={formatDateTime(a.at)}>{formatRelative(a.at)}</span>,
    },
    { header: 'Action', cell: (a) => <span className={mono}>{a.action}</span> },
    { header: 'Résultat', cell: (a) => a.outcome },
    {
      header: 'Dossier',
      cell: (a) => (
        <Link href={`/dossiers/${encodeURIComponent(a.requestId)}`} className={cn(mono, 'underline')}>
          {a.requestId}
        </Link>
      ),
    },
    { header: 'Révision', cell: (a) => a.revision },
    { header: 'Acteur', cell: (a) => <span className={mono}>{a.actorRef ?? '-'}</span> },
    { header: 'Trace', cell: (a) => <CopyTrace traceId={a.traceId} onCopied={() => toast.show('Trace copiée.')} /> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PaginatedTable
        label="Journal d’audit"
        noun="le journal d’audit"
        columns={columns}
        rowKey={(a) => a.id}
        load={load}
        className="min-w-[900px]"
      />
      <p className="text-[13px] text-ink-subtle">
        Le journal ne contient que des identifiants : ni données de dossier ni texte de conversation.
      </p>
      <div aria-live="polite">
        <Toast message={toast.message} onDismiss={toast.dismiss} />
      </div>
    </div>
  );
}

export function ActivityLog() {
  return <DepartmentGate>{(departmentId) => <Log departmentId={departmentId} />}</DepartmentGate>;
}
