'use client';

import { Tile } from '@techma/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';
import { AdministrationGate, Skeleton } from '@/components/admin/console/administration-gate';
import { useConsole } from '@/components/admin/console/console-context';
import { PageHeader } from '@/components/admin/page-header';
import { adminApi, type Case, type CaseView, type Dashboard } from '@/lib/admin/api';
import { formatInteger } from '@/lib/admin/format';
import { CHANNEL_LABELS, formatHours, formatPeriod } from '@/lib/admin/work-format';
import { useRemote } from '@/lib/admin/work-remote';
import { RemoteError } from './remote-error';
import { CaseRow } from './work-row';

const tileTitle = 'font-display text-2xl font-extrabold tracking-[-0.035em]';
const HEADER = (
  <PageHeader
    title="Vue d’ensemble"
    description="Ce qui arrive dans votre administration et ce qui attend une décision de votre équipe."
  />
);

function StatTile({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-card border border-line p-5">
      <dt className="text-sm font-medium text-ink-muted">{label}</dt>
      <dd className="m-0 flex flex-col gap-1">
        <span className="text-[32px] leading-none font-semibold tracking-[-0.02em] text-ink">{value}</span>
        {caption ? <span className="text-[13px] text-ink-muted">{caption}</span> : null}
      </dd>
    </div>
  );
}

/** The pending count leads (it is what the administration acts on); the other figures stay compact beside it. */
function Kpis({ dashboard, canReadCases }: { dashboard: Dashboard; canReadCases: boolean }) {
  const { metrics, unansweredOpen } = dashboard;
  return (
    <section aria-label="Indicateurs" className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">{formatPeriod(metrics.period)}</p>
      <dl className="m-0 grid gap-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
        <div className="flex min-w-0 flex-col gap-3 rounded-card bg-sunken p-5 sm:col-span-3 lg:col-span-1">
          <dt className="text-sm font-medium text-ink-muted">En attente</dt>
          <dd className="m-0 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <span className="text-[56px] leading-[0.9] font-semibold tracking-[-0.03em] text-ink">
              {formatInteger(metrics.pending)}
            </span>
            {canReadCases ? (
              <Link href="/admin/en-attente" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline">
                Voir les dossiers
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            ) : null}
          </dd>
        </div>
        <StatTile label="Reçus" value={formatInteger(metrics.received)} caption="dossiers déposés" />
        <StatTile label="Complément demandé" value={formatInteger(metrics.informationRequested)} />
        <StatTile label="Rejetés" value={formatInteger(metrics.rejected)} />
        <StatTile label="Complétés par l’assistant" value={formatInteger(metrics.completedByAssistant)} />
        <StatTile
          label="Complétés par un agent"
          value={formatInteger(metrics.completed - metrics.completedByAssistant)}
        />
        <StatTile label="Délai médian" value={formatHours(metrics.medianProcessingHours)} caption="du dépôt à la fin" />
      </dl>
      <p className="text-sm text-ink-muted">
        <Link href="/admin/sans-reponse" className="font-semibold text-ink underline">
          {formatInteger(unansweredOpen)} question{unansweredOpen > 1 ? 's' : ''} sans réponse
        </Link>{' '}
        à traiter.
      </p>
    </section>
  );
}

function RecentTile({
  title,
  href,
  view,
  administrationId,
}: {
  title: string;
  href: string;
  view: Exclude<CaseView, 'all'>;
  administrationId: string | undefined;
}) {
  const load = useCallback(async () => {
    const page = await adminApi.listCases({ administrationId, view, limit: 5 });
    return page.items;
  }, [administrationId, view]);
  const { data, status, error, reload } = useRemote<Case[]>(load);
  return (
    <Tile tone="outline" className="flex flex-col gap-4 md:p-8">
      <h2 className={tileTitle}>{title}</h2>
      {status === 'loading' && !data ? <Skeleton lines={3} /> : null}
      {status === 'error' ? <RemoteError error={error} noun="les dossiers" onRetry={reload} /> : null}
      {data && data.length === 0 ? <p className="text-ink-muted">Aucun dossier</p> : null}
      {data && data.length > 0 ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {data.map((item) => (
            <CaseRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
      <Link href={href} className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-ink underline">
        Voir tout
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </Tile>
  );
}

function Breakdown({ dashboard }: { dashboard: Dashboard }) {
  const { topProcedures, byChannel } = dashboard.metrics;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Tile tone="default" className="md:p-8">
        <h2 className={tileTitle}>Démarches les plus demandées</h2>
        {topProcedures.length === 0 ? (
          <p className="mt-3 text-ink-muted">Aucune demande sur la période.</p>
        ) : (
          <ol className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
            {topProcedures.map((entry) => (
              <li key={entry.procedureId} className="flex items-baseline justify-between gap-4">
                <span>{entry.title}</span>
                <span className="font-semibold tabular-nums">{formatInteger(entry.count)}</span>
              </li>
            ))}
          </ol>
        )}
      </Tile>
      <Tile tone="default" className="md:p-8">
        <h2 className={tileTitle}>Canaux</h2>
        {byChannel.length === 0 ? (
          <p className="mt-3 text-ink-muted">Aucune demande sur la période.</p>
        ) : (
          <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
            {byChannel.map((entry) => (
              <li key={entry.channel} className="flex items-baseline justify-between gap-4">
                <span>{CHANNEL_LABELS[entry.channel] ?? entry.channel}</span>
                <span className="font-semibold tabular-nums">{formatInteger(entry.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </Tile>
    </div>
  );
}

function Overview({ administrationId }: { administrationId: string | undefined }) {
  const { can } = useConsole();
  const canReadCases = can('cases:read');
  const load = useCallback(() => adminApi.getDashboard({ administrationId }), [administrationId]);
  const { data: dashboard, status, error, reload } = useRemote(load);

  return (
    <>
      {HEADER}
      <div className="flex flex-col gap-8">
        {status === 'loading' && !dashboard ? <Skeleton lines={2} /> : null}
        {status === 'error' ? <RemoteError error={error} noun="les indicateurs" onRetry={reload} /> : null}
        {dashboard ? <Kpis dashboard={dashboard} canReadCases={canReadCases} /> : null}
        {canReadCases ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <RecentTile title="En attente" href="/admin/en-attente" view="pending" administrationId={administrationId} />
            <RecentTile title="Complété" href="/admin/complete" view="completed" administrationId={administrationId} />
          </div>
        ) : null}
        {dashboard ? <Breakdown dashboard={dashboard} /> : null}
      </div>
    </>
  );
}

export function WorkOverview() {
  return <AdministrationGate header={HEADER}>{(administrationId) => <Overview administrationId={administrationId} />}</AdministrationGate>;
}
