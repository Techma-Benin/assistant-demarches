'use client';

import { Badge, Button, Card, InlineAlert, cn } from '@techma/ui';
import { CircleCheck, FilePen, TriangleAlert, Wrench } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { type Metrics } from '@/lib/c3-client';
import {
  conversationsByChannel,
  conversationsByDay,
  pendingItems,
  recentAudit,
  recentConversations,
  useDashboardData,
  type Section,
} from '@/lib/dashboard-data';
import { formatDateTime, formatInteger, formatMs, formatRate, shorten } from '@/lib/format';
import { ChannelBreakdown, CHANNEL_LABEL, DailyChart } from './dashboard-charts';
import { errorMessage } from './paginated-table';

const rise = (index: number): CSSProperties => ({ transitionDelay: `${index * 40}ms` });
const mono = 'font-mono text-[13px]';

function MetricCard({
  label,
  value,
  caption,
  tone = 'default',
  valueClassName,
  index,
}: {
  label: string;
  value: string | null;
  caption?: string;
  tone?: 'default' | 'trust';
  valueClassName?: string;
  index: number;
}) {
  return (
    <Card tone={tone} className="ui-rise flex flex-col gap-2" style={rise(index)} aria-busy={value === null}>
      <p className="text-sm text-ink-muted">{label}</p>
      {value === null ? (
        <span aria-hidden="true" className="block h-8 w-1/2 animate-pulse rounded-pill bg-sunken" />
      ) : (
        <p key="value" className={cn('ui-swap text-[28px] leading-tight font-extrabold tracking-tight', valueClassName)}>{value}</p>
      )}
      {caption ? <p className="text-sm text-ink-muted">{caption}</p> : null}
    </Card>
  );
}

function SectionError({ error, noun, onRetry }: { error: unknown; noun: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <InlineAlert>{errorMessage(error, noun)}</InlineAlert>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <span className="block h-4 w-3/4 animate-pulse rounded-pill bg-sunken" />
      <span className="block h-4 w-1/2 animate-pulse rounded-pill bg-sunken" />
      <span className="block h-4 w-2/3 animate-pulse rounded-pill bg-sunken" />
    </div>
  );
}

/** A dashboard card whose body depends on one loaded section (loading, error + retry, or content). */
function DataCard<T>({
  title,
  section,
  noun,
  onRetry,
  index,
  className,
  action,
  children,
}: {
  title: string;
  section: Section<T>;
  noun: string;
  onRetry: () => void;
  index: number;
  className?: string;
  action?: { href: string; label: string };
  children: (data: T) => ReactNode;
}) {
  return (
    <Card className={cn('ui-rise flex flex-col gap-4', className)} style={rise(index)} aria-busy={section.status === 'loading'}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold">{title}</h2>
        {action ? (
          <Link href={action.href} className="text-sm font-semibold underline">
            {action.label}
          </Link>
        ) : null}
      </div>
      {section.status === 'loading' ? <Skeleton /> : null}
      {section.status === 'error' ? <SectionError error={section.error} noun={noun} onRetry={onRetry} /> : null}
      {section.status === 'ready' ? children(section.data) : null}
    </Card>
  );
}

/** Merges several sections: loading while any loads, else the first error, else all data. */
function combine<A, B, C>(a: Section<A>, b: Section<B>, c: Section<C>): Section<[A, B, C]> {
  const all = [a, b, c];
  const failed = all.find((section) => section.status === 'error');
  if (failed && failed.status === 'error') return failed;
  if (a.status !== 'ready' || b.status !== 'ready' || c.status !== 'ready') return { status: 'loading' };
  return { status: 'ready', data: [a.data, b.data, c.data] };
}

function PendingRow({ icon, tone, children, action }: { icon: ReactNode; tone?: 'warning'; children: ReactNode; action?: ReactNode }) {
  return (
    <li className={cn('flex min-h-11 items-center gap-3 text-sm', tone === 'warning' && 'text-warning')}>
      <span aria-hidden="true" className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {action}
    </li>
  );
}

const rowLink = 'shrink-0 text-sm font-semibold underline';

export function Dashboard({ load }: { load?: () => Promise<Metrics> }) {
  const { metrics, conversations, audit, procedures, tools, models, retry } = useDashboardData(load);

  const m = metrics.status === 'ready' ? metrics.data : null;
  const pending = combine(procedures, tools, models);

  const retryPending = () => {
    for (const [key, section] of [['procedures', procedures], ['tools', tools], ['models', models]] as const) {
      if (section.status === 'error') retry(key);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {metrics.status === 'error' ? (
        <SectionError error={metrics.error} noun="les indicateurs" onRetry={() => retry('metrics')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Conversations" index={0} value={m && formatInteger(m.conversationCount)} />
          <MetricCard
            label="Latence p95"
            index={1}
            value={m && (m.p95LatencyMs === 0 ? '—' : formatMs(m.p95LatencyMs))}
            caption={m && m.p95LatencyMs === 0 ? 'Pas encore mesuré' : undefined}
          />
          <MetricCard
            label="Réponses sourcées"
            index={2}
            tone={m && m.sourcedAnswerRate > 0 ? 'trust' : 'default'}
            valueClassName={m && m.sourcedAnswerRate > 0 ? 'text-trust-text' : undefined}
            value={m && formatRate(m.sourcedAnswerRate)}
            caption={m && m.sourcedAnswerRate === 0 ? 'Aucune réponse sourcée mesurée' : undefined}
          />
          <MetricCard
            label="Erreurs"
            index={3}
            value={m && formatInteger(m.errorCount)}
            valueClassName={m && m.errorCount > 0 ? 'text-danger' : undefined}
            caption={m && m.errorCount === 0 ? 'Aucune erreur' : undefined}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <DataCard
          title="Conversations par jour"
          section={conversations}
          noun="les conversations"
          onRetry={() => retry('conversations')}
          index={4}
          className="lg:col-span-2"
        >
          {({ items, partial }) => (
            <>
              <p className="-mt-3 text-sm text-ink-muted">14 derniers jours</p>
              <DailyChart days={conversationsByDay(items)} partialCap={partial ? items.length : undefined} />
            </>
          )}
        </DataCard>
        <DataCard title="Par canal" section={conversations} noun="les conversations" onRetry={() => retry('conversations')} index={5}>
          {({ items }) => <ChannelBreakdown counts={conversationsByChannel(items)} />}
        </DataCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DataCard title="À traiter" section={pending} noun="les éléments à traiter" onRetry={retryPending} index={6}>
          {([procedureData, toolData, modelData]) => {
            const items = pendingItems(procedureData.items, toolData.items, modelData.items);
            const empty = items.draftProcedures.length === 0 && items.disabledTools.length === 0 && !items.noActiveModel;
            if (empty) {
              return (
                <p className="flex items-center gap-2 text-sm text-trust-text">
                  <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
                  Rien à traiter pour le moment.
                </p>
              );
            }
            return (
              <ul className="flex flex-col">
                {items.noActiveModel ? (
                  <PendingRow
                    tone="warning"
                    icon={<TriangleAlert className="size-4" />}
                    action={<Link href="/models" className={rowLink}>Voir les modèles</Link>}
                  >
                    Aucun modèle actif
                  </PendingRow>
                ) : null}
                {items.draftProcedures.map((procedure) => (
                  <PendingRow
                    key={procedure.id}
                    icon={<FilePen className="size-4 text-ink-muted" />}
                    action={
                      <Link href={`/procedures/${encodeURIComponent(procedure.id)}`} className={rowLink} aria-label={`Modifier ${procedure.title}`}>
                        Modifier
                      </Link>
                    }
                  >
                    <span className="mr-2 font-semibold">{procedure.title}</span>
                    <Badge tone="warning">Brouillon</Badge>
                  </PendingRow>
                ))}
                {items.disabledTools.map((tool) => (
                  <PendingRow
                    key={tool.name}
                    icon={<Wrench className="size-4 text-ink-muted" />}
                    action={<Link href="/tools" className={rowLink} aria-label={`Gérer l’outil ${tool.name}`}>Gérer</Link>}
                  >
                    <span className="font-semibold">{tool.name}</span> <span className="text-ink-muted">· outil désactivé</span>
                  </PendingRow>
                ))}
              </ul>
            );
          }}
        </DataCard>

        <DataCard title="Modèle actif" section={models} noun="les modèles" onRetry={() => retry('models')} index={7}>
          {({ items }) => {
            const active = items.filter((model) => model.active);
            if (active.length === 0) {
              return (
                <p className="flex items-start gap-2 rounded-field bg-warning-soft px-3 py-2 text-sm font-semibold text-warning">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  Aucun modèle actif
                </p>
              );
            }
            return (
              <ul className="flex flex-col gap-4">
                {active.map((model) => (
                  <li key={model.id} className="flex flex-wrap items-start justify-between gap-3">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                      <dt className="text-ink-muted">Identifiant</dt>
                      <dd className={mono}>{model.id}</dd>
                      <dt className="text-ink-muted">Fournisseur</dt>
                      <dd>{model.provider}</dd>
                      <dt className="text-ink-muted">Modèle</dt>
                      <dd className={mono}>{model.model}</dd>
                      <dt className="text-ink-muted">Instructions</dt>
                      <dd>{model.promptVersion}</dd>
                      <dt className="text-ink-muted">Température</dt>
                      <dd>{model.temperature}</dd>
                    </dl>
                    <Link href={`/models/${encodeURIComponent(model.id)}`} className={rowLink} aria-label={`Régler ${model.id}`}>
                      Régler
                    </Link>
                  </li>
                ))}
              </ul>
            );
          }}
        </DataCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DataCard
          title="Dernières modifications"
          section={audit}
          noun="le journal d’audit"
          onRetry={() => retry('audit')}
          index={8}
          action={{ href: '/audit', label: 'Tout voir' }}
        >
          {({ items }) =>
            items.length === 0 ? (
              <p className="text-sm text-ink-muted">Aucune modification enregistrée.</p>
            ) : (
              <ul className="flex flex-col">
                {recentAudit(items, 5).map((entry) => (
                  <li key={entry.id} className="flex min-h-11 flex-col justify-center gap-0.5 border-b border-line py-2 text-sm last:border-b-0">
                    <span>
                      <span className="font-semibold">{entry.action}</span>{' '}
                      <span className={cn(mono, 'break-all text-ink-muted')}>{entry.resourceId}</span>
                    </span>
                    <span className="text-ink-muted">
                      {entry.actorRef} · {formatDateTime(entry.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </DataCard>

        <DataCard
          title="Dernières conversations"
          section={conversations}
          noun="les conversations"
          onRetry={() => retry('conversations')}
          index={9}
          action={{ href: '/conversations', label: 'Tout voir' }}
        >
          {({ items }) =>
            items.length === 0 ? (
              <p className="text-sm text-ink-muted">Aucune conversation pour le moment.</p>
            ) : (
              <ul className="flex flex-col">
                {recentConversations(items, 5).map((conversation) => (
                  <li key={conversation.id} className="flex min-h-11 items-center gap-3 border-b border-line py-2 text-sm last:border-b-0">
                    <Badge>{CHANNEL_LABEL[conversation.channel]}</Badge>
                    <span className={cn(mono, 'min-w-0 flex-1')} title={conversation.id}>
                      {shorten(conversation.id, 12)}
                    </span>
                    <span className="shrink-0 text-ink-muted">{formatDateTime(conversation.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )
          }
        </DataCard>
      </div>
    </div>
  );
}
