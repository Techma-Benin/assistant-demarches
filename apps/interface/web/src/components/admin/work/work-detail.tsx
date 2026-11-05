'use client';

import { Badge, Card, Toast } from '@techma/ui';
import { ArrowLeft, Check, CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { useCallback, type ReactNode } from 'react';
import { Skeleton } from '@/components/admin/console/administration-gate';
import { useConsole } from '@/components/admin/console/console-context';
import { RequirePermission } from '@/components/admin/console/require-permission';
import { useToast } from '@/components/admin/use-toast';
import { adminApi, type Case, type CaseDocument, type CaseStep } from '@/lib/admin/api';
import { badgeTone } from '@/lib/admin/badge-tone';
import { formatDateTime, formatFcfa } from '@/lib/admin/format';
import {
  ACTOR_LABELS,
  PAYMENT_LABELS,
  completedByLabel,
  formatBytes,
  formatFieldValue,
  humanizeKey,
  tabOfStatus,
} from '@/lib/admin/work-format';
import { useRemote } from '@/lib/admin/work-remote';
import { CaseHistory } from './case-history';
import { FileTypeIcon } from './file-type-icon';
import { RemoteError } from './remote-error';
import { CaseStatusPill, ChannelPill } from './work-row';
import { useWorkActions, WorkActionNote, WorkActionToolbar } from './work-actions';

const cardTitle = 'text-[17px] leading-tight font-semibold tracking-[-0.02em] text-ink';
const card = 'flex flex-col gap-4 rounded-card border border-line bg-surface p-5';

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="m-0 mt-1 text-base font-semibold text-ink">{children}</dd>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function OfficialMark({ id, name }: { id: string; name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tracking-wide ${badgeTone(id)}`}
      >
        {initials(name)}
      </span>
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}

function PaymentMark({ payment }: { payment: Case['payment'] }) {
  if (payment.status === 'paid') {
    return (
      <Badge tone="trust" icon={<CircleCheck aria-hidden="true" className="size-3.5" />}>
        Payé · {formatFcfa(payment.amountFcfa)}
      </Badge>
    );
  }
  return <Badge tone="neutral">{PAYMENT_LABELS[payment.status] ?? payment.status}</Badge>;
}

function isProcedureStep(step: CaseStep): boolean {
  return step.id !== 'claim' && !/pris en charge/i.test(step.label);
}

const STEP_ICON: Record<CaseStep['state'], { label: string; className: string }> = {
  done: { label: 'terminée', className: 'bg-trust text-on-trust' },
  pending: { label: 'en attente', className: 'border-2 border-line-strong text-ink-muted' },
  blocked: { label: 'bloquée', className: 'border-2 border-danger text-danger' },
};

function StepMark({ state }: { state: CaseStep['state'] }) {
  const mark = STEP_ICON[state];
  return (
    <span
      role="img"
      aria-label={mark.label}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-pill ${mark.className}`}
    >
      {state === 'done' ? <Check className="size-[13px]" strokeWidth={3.6} /> : null}
    </span>
  );
}

function Documents({ title, caseId, documents }: { title: string; caseId: string; documents: CaseDocument[] }) {
  if (documents.length === 0) return null;
  return (
    <section aria-label={title} className={card}>
      <h2 className={cardTitle}>{title}</h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {documents.map((doc) => (
          <li
            key={doc.id}
            className="flex items-center gap-3 border-t border-line-subtle py-3 first:border-t-0 first:pt-0 last:pb-0"
          >
            <FileTypeIcon name={doc.name} mimeType={doc.mimeType} />
            <div className="min-w-0">
              <a
                className="font-semibold text-ink underline transition-opacity duration-(--ui-dur-exit) ease-(--ui-ease-out) hover:opacity-70 motion-reduce:transition-none"
                href={adminApi.documentUrl(caseId, doc.id)}
                download
              >
                {doc.name}
              </a>
              <p className="m-0 text-[13px] text-ink-muted">
                {formatBytes(doc.sizeBytes)} · {formatDateTime(doc.createdAt)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Detail({ item }: { item: Case }) {
  const { officialName } = useConsole();
  const fields = Object.entries(item.fields);
  const done = completedByLabel(item);
  const submitted = item.documents.filter((doc) => doc.kind === 'submitted');
  const issued = item.documents.filter((doc) => doc.kind === 'issued');
  const steps = item.steps.filter(isProcedureStep);
  const claimant = item.claimedBy ? officialName(item.claimedBy) : null;
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Détails du dossier" className={card}>
        <h2 className={cardTitle}>Détails</h2>
        <div className="flex flex-col gap-5">
          <dl className="m-0 grid gap-x-8 gap-y-5 sm:grid-cols-3">
            {item.claimedBy && claimant ? (
              <Meta label="Pris en charge par">
                <OfficialMark id={item.claimedBy} name={claimant} />
              </Meta>
            ) : null}
            <Meta label="Paiement">
              <PaymentMark payment={item.payment} />
            </Meta>
            <Meta label="Canal">
              <ChannelPill channel={item.channel} />
            </Meta>
          </dl>
          <dl className="m-0 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-[13px] text-ink-muted">Référence</dt>
              <dd className="m-0 mt-1 font-mono text-xs text-ink-muted">{item.reference}</dd>
              <dt className="mt-2 text-[13px] text-ink-muted">Procédure</dt>
              <dd className="m-0 mt-1 font-mono text-[13px] font-semibold text-ink">{item.procedureId}</dd>
            </div>
            <Meta label="Déposé le">{formatDateTime(item.createdAt)}</Meta>
            <Meta label="Mis à jour le">{formatDateTime(item.updatedAt)}</Meta>
            {done ? <Meta label="Complété">{done}</Meta> : null}
          </dl>
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.75fr)_minmax(17rem,22rem)]">
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-label="Informations du dossier" className={card}>
            <h2 className={cardTitle}>Informations</h2>
            {fields.length === 0 ? (
              <p className="text-ink-muted">Aucune information renseignée.</p>
            ) : (
              <dl className="m-0 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                {fields.map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt className="text-[13px] text-ink-muted">{humanizeKey(key)}</dt>
                    <dd className="m-0 mt-1 break-words text-base font-semibold text-ink">{formatFieldValue(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {item.informationRequest ? (
            <Card tone="warning" className="p-5" role="region" aria-label="Complément demandé">
              <h2 className="font-semibold">Complément demandé à l’usager</h2>
              <p className="mt-1 whitespace-pre-wrap">{item.informationRequest.note}</p>
              <p className="mt-2 text-[13px] text-ink-muted">
                Demandé par {officialName(item.informationRequest.requestedBy)} le{' '}
                {formatDateTime(item.informationRequest.requestedAt)}
              </p>
            </Card>
          ) : null}

          {item.decisionNote ? (
            <Card
              tone={item.status === 'rejected' ? 'danger' : 'default'}
              className="p-5"
              role="region"
              aria-label="Décision"
            >
              <h2 className="font-semibold">{item.status === 'rejected' ? 'Motif du rejet' : 'Note de décision'}</h2>
              <p className="mt-1 whitespace-pre-wrap">{item.decisionNote}</p>
            </Card>
          ) : null}

          <CaseHistory caseId={item.id} administrationId={item.administrationId} version={item.updatedAt} />
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <section aria-label="Étapes" className={card}>
            <h2 className={cardTitle}>Étapes</h2>
            <ol className="m-0 flex list-none flex-col p-0">
              {steps.map((step) => (
                <li key={step.id} className="flex gap-3 border-t border-line-subtle py-3 first:border-t-0 first:pt-0 last:pb-0">
                  <StepMark state={step.state} />
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-ink">{step.label}</p>
                    <p className="text-[13px] text-ink-muted">
                      {ACTOR_LABELS[step.actor]}
                      {step.at ? ` · ${formatDateTime(step.at)}` : ''}
                    </p>
                    {step.note ? <p className="text-[13px] text-ink-muted">{step.note}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <Documents title="Pièces de l’usager" caseId={item.id} documents={submitted} />
          <Documents title="Documents délivrés" caseId={item.id} documents={issued} />
        </aside>
      </div>
    </div>
  );
}

function Content({ id }: { id: string }) {
  const { can, official } = useConsole();
  const load = useCallback(() => adminApi.getCase(id), [id]);
  const { data: item, status, error, reload, setData } = useRemote(load);
  const toast = useToast();
  const tab = item ? tabOfStatus(item.status) : undefined;
  const work = useWorkActions({
    item,
    enabled: can('cases:act'),
    officialId: official?.id,
    onUpdated: (updated, message) => {
      setData(updated);
      toast.show(message);
    },
    onConflict: reload,
  });

  return (
    <>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 font-display text-2xl leading-tight font-extrabold tracking-[-0.035em] break-words">
              {item?.title ?? 'Dossier'}
            </h1>
            {item ? <CaseStatusPill status={item.status} /> : null}
          </div>
          <p className="mt-2.5 max-w-[620px] text-base text-ink-muted">
            <Link
              href={`/admin/${tab?.slug ?? 'en-attente'}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold underline"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Retour aux dossiers {tab ? tab.title.toLowerCase() : 'en attente'}
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Toast message={toast.message} onDismiss={toast.dismiss} />
          <WorkActionToolbar actions={work.actions} sending={work.sending} onStart={work.start} />
        </div>
      </header>
      <WorkActionNote
        pending={work.pending}
        note={work.note}
        setNote={work.setNote}
        sending={work.sending}
        error={work.error}
        noteCopy={work.noteCopy}
        onSend={work.send}
        onCancel={work.cancel}
      />
      {status === 'loading' && !item ? <Skeleton lines={4} /> : null}
      {status === 'error' && !item ? <RemoteError error={error} noun="le dossier" onRetry={reload} /> : null}
      {item ? <Detail item={item} /> : null}
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
