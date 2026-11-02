'use client';

import { Toast } from '@techma/ui';
import { ArrowLeft, FileText } from 'lucide-react';
import Link from 'next/link';
import { useCallback, type ReactNode } from 'react';
import { Skeleton } from '@/components/admin/console/administration-gate';
import { useConsole } from '@/components/admin/console/console-context';
import { RequirePermission } from '@/components/admin/console/require-permission';
import { PageHeader } from '@/components/admin/page-header';
import { useToast } from '@/components/admin/use-toast';
import { adminApi, type Case, type CaseDocument } from '@/lib/admin/api';
import { formatDateTime, formatFcfa } from '@/lib/admin/format';
import {
  ACTOR_LABELS,
  CHANNEL_LABELS,
  PAYMENT_LABELS,
  STEP_STATE_LABELS,
  completedByLabel,
  formatBytes,
  formatFieldValue,
  humanizeKey,
  tabOfStatus,
} from '@/lib/admin/work-format';
import { useRemote } from '@/lib/admin/work-remote';
import { CaseHistory } from './case-history';
import { RemoteError } from './remote-error';
import { CaseReference, CaseStatusPill } from './work-row';
import { WorkActions } from './work-actions';

const h2 = 'font-display text-2xl font-extrabold tracking-[-0.035em]';

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="m-0 text-base text-ink">{children}</dd>
    </div>
  );
}

function Documents({ title, caseId, documents }: { title: string; caseId: string; documents: CaseDocument[] }) {
  if (documents.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <h2 className={h2}>{title}</h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {documents.map((doc) => (
          <li key={doc.id} className="flex flex-wrap items-center gap-3">
            <FileText aria-hidden="true" className="size-4 text-ink-muted" />
            <a className="font-semibold underline" href={adminApi.documentUrl(caseId, doc.id)} download>
              {doc.name}
            </a>
            <span className="text-[13px] text-ink-muted">
              {formatBytes(doc.sizeBytes)} · {formatDateTime(doc.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Detail({
  item,
  canAct,
  onUpdated,
  onConflict,
}: {
  item: Case;
  canAct: boolean;
  onUpdated: (item: Case, message: string) => void;
  onConflict: () => void;
}) {
  const { officialName } = useConsole();
  const fields = Object.entries(item.fields);
  const done = completedByLabel(item);
  const submitted = item.documents.filter((doc) => doc.kind === 'submitted');
  const issued = item.documents.filter((doc) => doc.kind === 'issued');
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center gap-3">
        <CaseStatusPill status={item.status} />
        <CaseReference item={item} />
        {item.simulated ? <span className="text-sm text-ink-muted">Dossier simulé : aucune démarche réelle</span> : null}
      </div>

      <dl className="m-0 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        <Meta label="Démarche">
          {item.title} <span className="font-mono text-[13px] text-ink-muted">{item.procedureId}</span>
        </Meta>
        <Meta label="Canal">{CHANNEL_LABELS[item.channel] ?? item.channel}</Meta>
        <Meta label="Déposé le">{formatDateTime(item.createdAt)}</Meta>
        <Meta label="Mis à jour le">{formatDateTime(item.updatedAt)}</Meta>
        {item.claimedBy ? <Meta label="Pris en charge par">{officialName(item.claimedBy)}</Meta> : null}
        {done ? <Meta label="Complété">{done}</Meta> : null}
        <Meta label="Paiement">
          {PAYMENT_LABELS[item.payment.status] ?? item.payment.status}
          {item.payment.status !== 'not_required' ? ` · ${formatFcfa(item.payment.amountFcfa)}` : ''}
          {item.payment.reference ? (
            <span className="ml-2 font-mono text-[13px] text-ink-muted">{item.payment.reference}</span>
          ) : null}
          {item.payment.paidAt ? (
            <span className="ml-2 text-[13px] text-ink-muted">le {formatDateTime(item.payment.paidAt)}</span>
          ) : null}
        </Meta>
      </dl>

      {item.informationRequest ? (
        <section aria-label="Complément demandé" className="rounded-tile bg-sunken p-6">
          <h2 className="font-semibold">Complément demandé à l’usager</h2>
          <p className="mt-1 whitespace-pre-wrap">{item.informationRequest.note}</p>
          <p className="mt-2 text-[13px] text-ink-muted">
            Demandé par {officialName(item.informationRequest.requestedBy)} le{' '}
            {formatDateTime(item.informationRequest.requestedAt)}
          </p>
        </section>
      ) : null}

      {item.decisionNote ? (
        <section aria-label="Décision" className="rounded-tile bg-sunken p-6">
          <h2 className="font-semibold">{item.status === 'rejected' ? 'Motif du rejet' : 'Note de décision'}</h2>
          <p className="mt-1 whitespace-pre-wrap">{item.decisionNote}</p>
        </section>
      ) : null}

      {canAct ? <WorkActions item={item} onUpdated={onUpdated} onConflict={onConflict} /> : null}

      <section aria-label="Étapes" className="flex flex-col gap-4">
        <h2 className={h2}>Étapes</h2>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {item.steps.map((step) => (
            <li key={step.id} className="flex flex-col gap-0.5 border-t border-line-subtle pt-3">
              <p className="text-base text-ink">
                <strong className="font-semibold">{step.label}</strong>
                <span className={step.state === 'blocked' ? 'ml-2 font-semibold text-danger' : 'ml-2 text-ink-muted'}>
                  {STEP_STATE_LABELS[step.state]}
                </span>
              </p>
              <p className="text-[13px] text-ink-muted">
                {ACTOR_LABELS[step.actor]}
                {step.at ? ` · ${formatDateTime(step.at)}` : ''}
              </p>
              {step.note ? <p className="text-[13px] text-ink-muted">{step.note}</p> : null}
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Informations du dossier" className="flex flex-col gap-4">
        <h2 className={h2}>Informations</h2>
        {fields.length === 0 ? (
          <p className="text-ink-muted">Aucune information renseignée.</p>
        ) : (
          <dl className="m-0 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {fields.map(([key, value]) => (
              <div key={key} className="flex flex-col gap-0.5 border-t border-line-subtle pt-3">
                <dt className="text-[13px] text-ink-muted">{humanizeKey(key)}</dt>
                <dd className="m-0 break-words text-base text-ink">{formatFieldValue(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <Documents title="Pièces de l’usager" caseId={item.id} documents={submitted} />
      <Documents title="Documents délivrés" caseId={item.id} documents={issued} />

      <CaseHistory caseId={item.id} administrationId={item.administrationId} version={item.updatedAt} />
    </div>
  );
}

function Content({ id }: { id: string }) {
  const { can } = useConsole();
  const load = useCallback(() => adminApi.getCase(id), [id]);
  const { data: item, status, error, reload, setData } = useRemote(load);
  const toast = useToast();
  const tab = item ? tabOfStatus(item.status) : undefined;

  return (
    <>
      <PageHeader
        title={item?.title ?? 'Dossier'}
        description={
          <Link
            href={`/admin/${tab?.slug ?? 'en-attente'}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold underline"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Retour aux dossiers {tab ? tab.title.toLowerCase() : 'en attente'}
          </Link>
        }
        actions={<Toast message={toast.message} onDismiss={toast.dismiss} />}
      />
      {status === 'loading' && !item ? <Skeleton lines={4} /> : null}
      {status === 'error' && !item ? <RemoteError error={error} noun="le dossier" onRetry={reload} /> : null}
      {item ? (
        <Detail
          item={item}
          canAct={can('cases:act')}
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

export function WorkItemDetail({ id }: { id: string }) {
  return (
    <RequirePermission permission="cases:read">
      <Content id={id} />
    </RequirePermission>
  );
}
