'use client';

import { Counter, CounterGrid, Tile } from '@techma/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { departmentApi, type AdminWorkItem, type Dashboard } from '@/lib/department-api';
import { formatInteger } from '@/lib/format';
import { CHANNEL_LABELS, formatDuration, formatPeriod } from '@/lib/work-format';
import { useRemote } from '@/lib/work-remote';
import { DepartmentGate, Skeleton } from './department-gate';
import { RemoteError } from './remote-error';
import { WorkRow } from './work-row';

const tileTitle = 'font-display text-2xl font-extrabold tracking-[-0.035em]';
const HEADER = (
  <PageHeader
    title="Vue d’ensemble"
    description="Ce qui arrive dans votre ministère et ce qui attend une décision de votre équipe."
  />
);

/** True once any listed item is a simulation. */
function useSimulationFlag() {
  const [value, setValue] = useState(false);
  const report = useCallback((items: AdminWorkItem[]) => {
    if (items.some((item) => item.simulation)) setValue(true);
  }, []);
  return { value, report };
}

function Kpis({ dashboard }: { dashboard: Dashboard }) {
  return (
    <section aria-label="Indicateurs" className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">{formatPeriod(dashboard.period)}</p>
      <CounterGrid>
        <Counter value={formatInteger(dashboard.received)} label="reçus" />
        <Counter value={formatInteger(dashboard.pending)} label="en attente" />
        <Counter value={formatInteger(dashboard.completedByAi)} label="complétés par l’IA" tone="trust" />
        <Counter
          value={formatInteger(dashboard.blocked)}
          label="bloqués"
          tone={dashboard.blocked > 0 ? 'danger' : 'default'}
        />
        <Counter
          value={formatInteger(dashboard.overdue)}
          label="en retard"
          tone={dashboard.overdue > 0 ? 'danger' : 'default'}
        />
        <Counter value={formatDuration(dashboard.medianProcessingMs)} label="médiane de traitement" />
      </CounterGrid>
    </section>
  );
}

function RecentTile({
  title,
  href,
  mode,
  departmentId,
  count,
  onLoaded,
}: {
  title: string;
  href: string;
  mode: 'pending' | 'completed';
  departmentId: string | undefined;
  /** Total from the dashboard when known. */
  count?: number;
  onLoaded: (items: AdminWorkItem[]) => void;
}) {
  const load = useCallback(async () => {
    const page = await departmentApi.listWorkItems({ departmentId, status: mode, limit: 5 });
    onLoaded(page.items);
    return page.items;
  }, [departmentId, mode, onLoaded]);
  const { data, status, error, reload } = useRemote(load);
  const shown = count ?? data?.length;
  return (
    <Tile tone="outline" className="flex flex-col gap-4 md:p-8">
      <h2 className={tileTitle}>{shown !== undefined && mode === 'pending' ? `${title} (${shown})` : title}</h2>
      {status === 'loading' && !data ? <Skeleton lines={3} /> : null}
      {status === 'error' ? <RemoteError error={error} noun="les dossiers" onRetry={reload} /> : null}
      {data && data.length === 0 ? <p className="text-ink-muted">Aucun dossier</p> : null}
      {data && data.length > 0 ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {data.map((item) => (
            <WorkRow key={item.id} item={item} mode={mode} />
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
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Tile tone="default" className="md:p-8">
        <h2 className={tileTitle}>Documents les plus demandés</h2>
        {dashboard.mostRequested.length === 0 ? (
          <p className="mt-3 text-ink-muted">Aucune demande sur la période.</p>
        ) : (
          <ol className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
            {dashboard.mostRequested.map((entry) => (
              <li key={entry.title} className="flex items-baseline justify-between gap-4">
                <span>{entry.title}</span>
                <span className="font-semibold tabular-nums">{formatInteger(entry.count)}</span>
              </li>
            ))}
          </ol>
        )}
      </Tile>
      <Tile tone="default" className="md:p-8">
        <h2 className={tileTitle}>Canaux</h2>
        {dashboard.channels.length === 0 ? (
          <p className="mt-3 text-ink-muted">Aucune demande sur la période.</p>
        ) : (
          <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
            {dashboard.channels.map((entry) => (
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

function Overview({ departmentId }: { departmentId: string | undefined }) {
  const load = useCallback(() => departmentApi.getDashboard({ departmentId }), [departmentId]);
  const { data: dashboard, status, error, reload } = useRemote(load);
  const simulated = useSimulationFlag();

  return (
    <>
      {HEADER}
      <div className="flex flex-col gap-10">
        {simulated.value ? (
          <p className="text-sm font-semibold text-ink-muted">Valeurs fictives : certains dossiers sont des simulations.</p>
        ) : null}
        {status === 'loading' && !dashboard ? <Skeleton lines={2} /> : null}
        {status === 'error' ? <RemoteError error={error} noun="les indicateurs" onRetry={reload} /> : null}
        {dashboard ? <Kpis dashboard={dashboard} /> : null}
        <div className="grid gap-6 lg:grid-cols-2">
          <RecentTile
            title="En attente"
            href="/a-verifier"
            mode="pending"
            departmentId={departmentId}
            count={dashboard?.pending}
            onLoaded={simulated.report}
          />
          <RecentTile
            title="Complété"
            href="/complete"
            mode="completed"
            departmentId={departmentId}
            onLoaded={simulated.report}
          />
        </div>
        {dashboard ? <Breakdown dashboard={dashboard} /> : null}
      </div>
    </>
  );
}

export function WorkOverview() {
  return <DepartmentGate header={HEADER}>{(departmentId) => <Overview departmentId={departmentId} />}</DepartmentGate>;
}
