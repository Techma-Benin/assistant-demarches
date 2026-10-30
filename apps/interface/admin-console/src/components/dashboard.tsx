'use client';

import { Button, Counter, CounterGrid, InlineAlert, Tile, cn } from '@techma/ui';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { type Metrics } from '@/lib/c3-client';
import {
  conversationsByDayAndChannel,
  staleProcedures,
  useDashboardData,
  type Section,
} from '@/lib/dashboard-data';
import { formatInteger, formatRate, formatSeconds } from '@/lib/format';
import { visibleProcedures } from '@/lib/visible-procedures';
import { DailyChart } from './dashboard-charts';
import { useSession } from './session/session-context';
import { errorMessage } from './paginated-table';

const GUARDRAILS = [
  'Toute information administrative vient d’une fiche validée, citée.',
  'Jamais de NPI, mot de passe ou code SMS demandé.',
  'Aucune action sur une demande sans mandat actif.',
  'Pièces conservées hors conversation, par référence.',
] as const;

const tileTitle = 'font-display text-2xl font-extrabold tracking-[-0.035em]';

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

/** Merges two sections: loading while one loads, else the first error, else both data. */
function combine<A, B>(a: Section<A>, b: Section<B>): Section<[A, B]> {
  if (a.status === 'error') return a;
  if (b.status === 'error') return b;
  if (a.status !== 'ready' || b.status !== 'ready') return { status: 'loading' };
  return { status: 'ready', data: [a.data, b.data] };
}

function CounterValue({ value }: { value: string | null }) {
  return value === null ? (
    <span aria-hidden="true" className="block h-[0.8em] w-24 animate-pulse rounded-pill bg-sunken" />
  ) : (
    <span key="value" className="ui-swap">{value}</span>
  );
}

function TodoRow({ href, count, title, description }: { href: string; count: number; title: string; description: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-16 items-center gap-3.5 rounded-[18px] bg-surface px-4 py-3 text-ink transition-transform duration-(--ui-dur-fast) ease-(--ui-ease-out) active:scale-[0.98] motion-reduce:active:scale-100"
      >
        <span className="min-w-9 font-display text-[28px] font-extrabold tracking-[-0.04em]">{formatInteger(count)}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-bold">{title}</span>
          <span className="text-[13px] text-ink-muted">{description}</span>
        </span>
        <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
      </Link>
    </li>
  );
}

/** Wraps a tile body that depends on loaded data: skeleton, error + retry, or content. */
function Body<T>({ section, noun, onRetry, children }: { section: Section<T>; noun: string; onRetry: () => void; children: (data: T) => ReactNode }) {
  if (section.status === 'loading') return <Skeleton />;
  if (section.status === 'error') return <SectionError error={section.error} noun={noun} onRetry={onRetry} />;
  return <>{children(section.data)}</>;
}

export function Dashboard({ load }: { load?: () => Promise<Metrics> }) {
  const { identity, can } = useSession();
  const canTools = can('tools.view');
  const { metrics, conversations, procedures, tools, retry } = useDashboardData(load, { tools: canTools });

  const m = metrics.status === 'ready' ? metrics.data : null;
  const todo = combine(procedures, tools);
  const retryTodo = () => {
    if (procedures.status === 'error') retry('procedures');
    if (canTools && tools.status === 'error') retry('tools');
  };

  return (
    <div className="flex flex-col gap-6">
      {metrics.status === 'error' ? (
        <SectionError error={metrics.error} noun="les indicateurs" onRetry={() => retry('metrics')} />
      ) : (
        <div aria-busy={m === null}>
        <CounterGrid>
          <Counter label="Conversations" value={<CounterValue value={m && formatInteger(m.conversationCount)} />} />
          <Counter
            label="Réponses sourcées"
            tone={m && m.sourcedAnswerRate > 0 ? 'trust' : 'default'}
            value={<CounterValue value={m && formatRate(m.sourcedAnswerRate)} />}
            caption={m ? (m.sourcedAnswerRate === 0 ? 'Aucune réponse sourcée mesurée' : 'citent une fiche validée') : undefined}
          />
          <Counter
            label="Latence p95"
            value={<CounterValue value={m && (m.p95LatencyMs === 0 ? '-' : formatSeconds(m.p95LatencyMs))} />}
            caption={m ? (m.p95LatencyMs === 0 ? 'Pas encore mesuré' : 'jusqu’au premier bloc') : undefined}
          />
          <Counter
            label="Erreurs"
            tone={m && m.errorCount > 0 ? 'danger' : 'default'}
            value={<CounterValue value={m && formatInteger(m.errorCount)} />}
            caption={m ? (m.errorCount === 0 ? 'Aucune erreur' : 'traitements en échec') : undefined}
          />
        </CounterGrid>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Tile tone="sun" className="ui-rise flex flex-col gap-3.5 p-7 md:p-7 lg:col-span-1" aria-busy={todo.status === 'loading'}>
          <h2 className={tileTitle}>À traiter aujourd’hui</h2>
          <Body section={todo} noun="les éléments à traiter" onRetry={retryTodo}>
            {([procedureData, toolData]) => {
              // Scope filter is defence in depth: the Backend already filters by administration.
              const scoped = visibleProcedures(identity, procedureData.items);
              const drafts = scoped.filter((procedure) => procedure.validationStatus === 'draft').length;
              const disabled = canTools ? toolData.items.filter((tool) => !tool.enabled).length : 0;
              const stale = staleProcedures(scoped).length;
              const partial = procedureData.partial || toolData.partial;
              if (drafts + disabled + stale === 0) {
                return <p className="text-[15px] font-semibold">Rien à traiter</p>;
              }
              return (
                <>
                  <ul className="flex flex-col gap-3.5">
                    {drafts > 0 ? (
                      <TodoRow
                        href="/procedures?status=draft"
                        count={drafts}
                        title="Fiches en brouillon"
                        description="Non citées par l’assistant tant qu’elles ne sont pas validées"
                      />
                    ) : null}
                    {disabled > 0 ? (
                      <TodoRow
                        href="/tools"
                        count={disabled}
                        title="Connexions MCP désactivées"
                        description="Le modèle ne peut pas les utiliser"
                      />
                    ) : null}
                    {stale > 0 ? (
                      <TodoRow
                        href="/procedures?stale=1"
                        count={stale}
                        title="Source à revérifier"
                        description="Consultée il y a plus de 90 jours"
                      />
                    ) : null}
                  </ul>
                  {partial ? <p className="text-[13px]">Calculé sur les éléments chargés seulement.</p> : null}
                </>
              );
            }}
          </Body>
        </Tile>

        <Tile className="ui-rise flex min-w-0 flex-col gap-5 p-7 md:p-7 lg:col-span-2" aria-busy={conversations.status === 'loading'}>
          <h2 className={tileTitle}>Conversations par canal</h2>
          <Body section={conversations} noun="les conversations" onRetry={() => retry('conversations')}>
            {({ items, partial }) => (
              <DailyChart days={conversationsByDayAndChannel(items)} partialCap={partial ? items.length : undefined} />
            )}
          </Body>
        </Tile>
      </div>

      <Tile tone="ink" className={cn('ui-rise flex flex-col gap-3.5 p-7 md:p-7')}>
        <h2 className={tileTitle}>Garde-fous</h2>
        <p className="text-sm leading-normal opacity-80">
          Ce que l’assistant applique à chaque réponse, quel que soit le modèle.
        </p>
        <ul className="flex flex-col gap-3.5">
          {GUARDRAILS.map((line) => (
            <li key={line} className="flex items-start gap-2.5 text-sm leading-[1.45]">
              <ShieldCheck aria-hidden="true" className="mt-px size-[18px] shrink-0" />
              {line}
            </li>
          ))}
        </ul>
      </Tile>
    </div>
  );
}
