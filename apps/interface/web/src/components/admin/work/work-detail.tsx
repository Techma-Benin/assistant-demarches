'use client';

import { StatusPill, Toast } from '@techma/ui';
import { ArrowLeft, FileText } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';
import { PageHeader } from '@/components/admin/page-header';
import { useToast } from '@/components/admin/use-toast';
import { departmentApi, type AdminWorkItem } from '@/lib/admin/department-api';
import { formatDateTime, formatFcfa } from '@/lib/admin/format';
import {
  EVIDENCE_SOURCES,
  PAYMENT_LABELS,
  STATUS_LABELS,
  completedByLabel,
  formatFieldValue,
  humanizeKey,
} from '@/lib/admin/work-format';
import { useRemote } from '@/lib/admin/work-remote';
import { Skeleton } from './department-gate';
import { RemoteError } from './remote-error';
import { SimulationPill } from './work-row';
import { WorkActions } from './work-actions';

const h2 = 'font-display text-2xl font-extrabold tracking-[-0.035em]';

function pillTone(status: AdminWorkItem['status']) {
  if (status === 'completed') return 'validated' as const;
  if (status === 'blocked' || status === 'rejected' || status === 'cancelled') return 'danger' as const;
  if (status === 'submitted') return 'toValidate' as const;
  return 'info' as const;
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="m-0 text-base text-ink">{children}</dd>
    </div>
  );
}

function Detail({ item, onUpdated, onConflict }: {
  item: AdminWorkItem;
  onUpdated: (item: AdminWorkItem, message: string) => void;
  onConflict: () => void;
}) {
  const fields = Object.entries(item.fields ?? {});
  const evidence = new Map((item.evidence ?? []).map((entry) => [entry.field, entry]));
  const done = completedByLabel(item);
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={pillTone(item.status)}>{STATUS_LABELS[item.status]}</StatusPill>
        {item.simulation ? <SimulationPill /> : null}
        {item.simulation ? (
          <span className="text-sm text-ink-muted">Dossier simulé : aucune démarche réelle</span>
        ) : null}
      </div>

      <dl className="m-0 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {item.receiptRef ? (
          <Meta label="Récépissé">
            <span className="font-mono">{item.receiptRef}</span>
          </Meta>
        ) : null}
        <Meta label="Créé le">{formatDateTime(item.createdAt)}</Meta>
        {item.submittedAt ? <Meta label="Déposé le">{formatDateTime(item.submittedAt)}</Meta> : null}
        {item.dueAt ? <Meta label="Échéance">{formatDateTime(item.dueAt)}</Meta> : null}
        {item.completedAt ? (
          <Meta label="Complété le">
            {formatDateTime(item.completedAt)}
            {done ? ` ${done}` : ''}
          </Meta>
        ) : null}
        {item.assignedTo ? <Meta label="Pris en charge par">{item.assignedTo}</Meta> : null}
        {item.progress ? (
          <Meta label="Avancement">
            Étape {item.progress.step} sur {item.progress.total} · {item.progress.label}
          </Meta>
        ) : null}
        {item.payment ? (
          <Meta label="Paiement">
            {PAYMENT_LABELS[item.payment.status] ?? item.payment.status}
            {item.payment.status !== 'not_required' ? ` · ${formatFcfa(item.payment.amountFcfa)}` : ''}
            {item.payment.reference ? (
              <span className="ml-2 font-mono text-[13px] text-ink-muted">{item.payment.reference}</span>
            ) : null}
          </Meta>
        ) : null}
        <Meta label="Pièces jointes">
          {item.fileIds.length} pièce{item.fileIds.length > 1 ? 's' : ''} conservée{item.fileIds.length > 1 ? 's' : ''} par référence
        </Meta>
      </dl>

      {item.blocking ? (
        <section aria-label="Blocage" className="rounded-tile bg-danger-soft p-6 text-danger">
          <h2 className="font-semibold">Dossier bloqué</h2>
          <p>{item.blocking.detail}</p>
          <p className="mt-1 font-mono text-[13px]">{item.blocking.code} · {formatDateTime(item.blocking.at)}</p>
        </section>
      ) : null}

      <WorkActions item={item} onUpdated={onUpdated} onConflict={onConflict} />

      <section aria-label="Informations du dossier" className="flex flex-col gap-4">
        <h2 className={h2}>Informations</h2>
        {fields.length === 0 ? (
          <p className="text-ink-muted">Aucune information renseignée.</p>
        ) : (
          <dl className="m-0 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {fields.map(([key, value]) => {
              const source = evidence.get(key);
              return (
                <div key={key} className="flex flex-col gap-0.5 border-t border-line-subtle pt-3">
                  <dt className="text-[13px] text-ink-muted">{humanizeKey(key)}</dt>
                  <dd className="m-0 break-words text-base text-ink">{formatFieldValue(value)}</dd>
                  {source ? (
                    <dd className="m-0 text-[13px] text-ink-subtle">
                      Source : {EVIDENCE_SOURCES[source.source] ?? source.source}
                      {source.reference ? ` (${source.reference})` : ''}
                      {source.confirmed ? ' · confirmé' : ' · à confirmer'}
                    </dd>
                  ) : null}
                </div>
              );
            })}
          </dl>
        )}
      </section>

      {item.documents && item.documents.length > 0 ? (
        <section aria-label="Documents délivrés" className="flex flex-col gap-4">
          <h2 className={h2}>Documents délivrés</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {item.documents.map((doc) => (
              <li key={doc.fileId} className="flex flex-wrap items-center gap-3">
                <FileText aria-hidden="true" className="size-4 text-ink-muted" />
                <a
                  className="font-semibold underline"
                  href={departmentApi.documentUrl(item.id, doc.fileId)}
                  download
                >
                  {doc.name}
                </a>
                <span className="text-[13px] text-ink-muted">Expire le {formatDateTime(doc.expiresAt)}</span>
                {doc.simulation ? <SimulationPill /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function WorkItemDetail({ id }: { id: string }) {
  const load = useCallback(() => departmentApi.getWorkItem(id), [id]);
  const { data: item, status, error, reload, setData } = useRemote(load);
  const toast = useToast();

  return (
    <>
      <PageHeader
        title={item?.title ?? 'Dossier'}
        description={
          <Link href="/admin/a-verifier" className="inline-flex items-center gap-1.5 text-sm font-semibold underline">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Retour aux dossiers en attente
          </Link>
        }
        actions={<Toast message={toast.message} onDismiss={toast.dismiss} />}
      />
      {status === 'loading' && !item ? <Skeleton lines={4} /> : null}
      {status === 'error' && !item ? <RemoteError error={error} noun="le dossier" onRetry={reload} /> : null}
      {item ? (
        <Detail
          item={item}
          onUpdated={(updated, message) => {
            setData(updated);
            toast.show(message);
          }}
          onConflict={reload}
        />
      ) : null}
    </>
  );
}
