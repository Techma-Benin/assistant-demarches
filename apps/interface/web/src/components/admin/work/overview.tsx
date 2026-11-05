'use client';

import { Clock, Inbox, Timer, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { AdministrationGate, Skeleton } from '@/components/admin/console/administration-gate';
import { useConsole } from '@/components/admin/console/console-context';
import { PageHeader } from '@/components/admin/page-header';
import { adminApi, type Case, type Dashboard } from '@/lib/admin/api';
import { formatInteger } from '@/lib/admin/format';
import { formatHours } from '@/lib/admin/work-format';
import { useRemote } from '@/lib/admin/work-remote';
import { RemoteError } from './remote-error';
import { CaseQueue, QueueChipRow, QueueSearch } from './work-table';
import './status-donut.css';

const HEADER = (
  <PageHeader
    title="Vue d’ensemble"
    description="Ce qui arrive dans votre administration et ce qui attend une décision de votre équipe."
  />
);

const RECENT_LIMIT = 8;

type Slice = {
  id: string;
  label: string;
  count: number;
  color: string;
  href?: string;
};

function statusSlices(dashboard: Dashboard, canReadCases: boolean): Slice[] {
  const { pending, informationRequested, completed, rejected } = dashboard.metrics;
  const waiting = Math.max(0, pending - informationRequested);
  return [
    {
      id: 'waiting',
      label: 'En vérification',
      count: waiting,
      color: 'var(--color-ink)',
      href: canReadCases ? '/admin/en-attente' : undefined,
    },
    {
      id: 'info',
      label: 'Complément demandé',
      count: informationRequested,
      color: 'var(--color-sun)',
      href: canReadCases ? '/admin/en-attente' : undefined,
    },
    {
      id: 'completed',
      label: 'Complétés',
      count: completed,
      color: 'var(--color-trust)',
      href: canReadCases ? '/admin/complete' : undefined,
    },
    {
      id: 'rejected',
      label: 'Rejetés',
      count: rejected,
      color: 'var(--color-flag-red)',
      href: canReadCases ? '/admin/rejete' : undefined,
    },
  ];
}

const DONUT = 168;
const DONUT_CENTER = DONUT / 2;
/** Ring thickness matches the previous inset hole (about 22% of the diameter). */
const DONUT_THICKNESS = 36;
/** One pixel inside the view box so the outer edge stays a full circle. */
const DONUT_OUTER = DONUT_CENTER - 1;
const DONUT_INNER = DONUT_OUTER - DONUT_THICKNESS;
/** Outward nudge along the segment bisector. A few pixels, like a detached slice. */
const DONUT_POP = 6;
/** Gap along the ring, short enough that the outer edge still reads as a circle. */
const DONUT_GAP = 2.5;

function sharePercent(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function polar(radius: number, angle: number) {
  return {
    x: DONUT_CENTER + radius * Math.sin(angle),
    y: DONUT_CENTER - radius * Math.cos(angle),
  };
}

function n(value: number): string {
  return value.toFixed(2);
}

/** SVG arc. Angle 0 is 12 o’clock; sweep 1 is clockwise. The current point is already `from`. */
function arcCommand(radius: number, from: number, to: number, sweep: 0 | 1): string {
  const end = polar(radius, to);
  const large = Math.abs(to - from) > Math.PI ? 1 : 0;
  return `A ${n(radius)} ${n(radius)} 0 ${large} ${sweep} ${n(end.x)} ${n(end.y)}`;
}

/** Filled annular sector. Radial edges, no caps, so the ring stays circular. */
function segmentPath(start: number, end: number): string {
  const outer = polar(DONUT_OUTER, start);
  const innerEnd = polar(DONUT_INNER, end);
  return [
    `M ${n(outer.x)} ${n(outer.y)}`,
    arcCommand(DONUT_OUTER, start, end, 1),
    `L ${n(innerEnd.x)} ${n(innerEnd.y)}`,
    arcCommand(DONUT_INNER, end, start, 0),
    'Z',
  ].join(' ');
}

/** Closed ring. Opposite windings so even-odd fill punches the hole. */
function fullRingPath(): string {
  const c = n(DONUT_CENTER);
  const outerTop = n(DONUT_CENTER - DONUT_OUTER);
  const outerBottom = n(DONUT_CENTER + DONUT_OUTER);
  const innerTop = n(DONUT_CENTER - DONUT_INNER);
  const innerBottom = n(DONUT_CENTER + DONUT_INNER);
  return [
    `M ${c} ${outerTop}`,
    `A ${n(DONUT_OUTER)} ${n(DONUT_OUTER)} 0 1 1 ${c} ${outerBottom}`,
    `A ${n(DONUT_OUTER)} ${n(DONUT_OUTER)} 0 1 1 ${c} ${outerTop}`,
    `M ${c} ${innerTop}`,
    `A ${n(DONUT_INNER)} ${n(DONUT_INNER)} 0 1 0 ${c} ${innerBottom}`,
    `A ${n(DONUT_INNER)} ${n(DONUT_INNER)} 0 1 0 ${c} ${innerTop}`,
    'Z',
  ].join(' ');
}

type Segment = {
  id: string;
  color: string;
  d: string;
  full: boolean;
  x: number;
  y: number;
};

function donutSegments(slices: Slice[], total: number): Segment[] {
  const drawn = slices.filter((slice) => slice.count > 0);
  if (drawn.length === 0 || total <= 0) return [];
  const single = drawn.length === 1;
  const midRadius = (DONUT_OUTER + DONUT_INNER) / 2;
  let cursor = 0;
  return drawn.map((slice) => {
    const sweep = (slice.count / total) * Math.PI * 2;
    const gap = single ? 0 : Math.min(DONUT_GAP / midRadius, sweep * 0.18);
    const start = cursor + gap / 2;
    const end = cursor + sweep - gap / 2;
    const mid = cursor + sweep / 2;
    cursor += sweep;
    return {
      id: slice.id,
      color: slice.color,
      d: single ? fullRingPath() : segmentPath(start, end),
      full: single,
      x: Math.sin(mid) * DONUT_POP,
      y: -Math.cos(mid) * DONUT_POP,
    };
  });
}

/** Shared card chrome. Hover lifts 1px and darkens the border; only transform is eased. */
const SURFACE =
  'rounded-card border border-line bg-surface transition-transform duration-(--ui-dur-exit) ease-(--ui-ease-out) hover:-translate-y-px hover:border-line-strong motion-reduce:transition-none motion-reduce:hover:translate-y-0';

function CornerMark({ icon: Icon, wash, mark }: { icon: LucideIcon; wash: string; mark: string }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute top-0 right-0 size-24">
      <span className={`absolute -top-4 -right-5 size-[92px] rounded-[42%_58%_46%_54%/56%_40%_60%_44%] ${wash}`} />
      <Icon className={`absolute top-5 right-5 size-[18px] ${mark}`} strokeWidth={1.75} />
    </span>
  );
}

function StatTile({
  label,
  value,
  icon,
  wash,
  mark,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  wash: string;
  mark: string;
}) {
  return (
    <div className={`relative flex min-w-0 flex-col-reverse gap-2 overflow-hidden p-5 ${SURFACE}`}>
      <dt className="text-[13px] font-medium text-ink-subtle">{label}</dt>
      <dd className="m-0 text-[40px] leading-none font-semibold tracking-[-0.04em] text-ink tabular-nums">{value}</dd>
      <CornerMark icon={icon} wash={wash} mark={mark} />
    </div>
  );
}

function Kpis({ dashboard }: { dashboard: Dashboard }) {
  const { metrics } = dashboard;

  return (
    <section aria-label="Indicateurs">
      <dl className="m-0 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile label="En attente" value={formatInteger(metrics.pending)} icon={Clock} wash="bg-sunken" mark="text-ink" />
        <StatTile label="Reçus" value={formatInteger(metrics.received)} icon={Inbox} wash="bg-trust-soft" mark="text-trust" />
        <StatTile
          label="Délai médian"
          value={formatHours(metrics.medianProcessingHours)}
          icon={Timer}
          wash="bg-[color-mix(in_srgb,var(--color-sun)_32%,var(--color-surface))]"
          mark="text-ink"
        />
      </dl>
    </section>
  );
}

function StatusDonut({ dashboard, canReadCases }: { dashboard: Dashboard; canReadCases: boolean }) {
  const slices = statusSlices(dashboard, canReadCases);
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const segments = donutSegments(slices, total);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const activeId = hovered ?? focused;
  const active = slices.find((slice) => slice.id === activeId) ?? null;

  const pointAt = (id: string) => setHovered(id);
  const leave = (id: string) => setHovered((current) => (current === id ? null : current));
  const focusAt = (id: string) => setFocused(id);
  const blurAt = (id: string) => setFocused((current) => (current === id ? null : current));

  return (
    <section className={`${SURFACE} p-5`}>
      <h2 className="text-[17px] leading-tight font-semibold tracking-[-0.02em] text-ink">Dossiers</h2>
      {total === 0 ? (
        <p className="mt-8 text-sm text-ink-muted">Aucun dossier sur la période.</p>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-8 sm:flex-row sm:items-center sm:gap-10">
          <div className="relative size-[168px] shrink-0">
            <svg viewBox={`0 0 ${DONUT} ${DONUT}`} className="size-full overflow-visible" aria-hidden="true">
              {segments.map((segment) => {
                const popped = activeId === segment.id && !segment.full;
                const motion = {
                  '--slice-x': popped ? `${segment.x.toFixed(2)}px` : '0px',
                  '--slice-y': popped ? `${segment.y.toFixed(2)}px` : '0px',
                } as CSSProperties;
                return (
                  <g
                    key={segment.id}
                    data-slice={segment.id}
                    className="status-donut-slice cursor-pointer"
                    style={motion}
                    onMouseEnter={() => pointAt(segment.id)}
                    onMouseLeave={() => leave(segment.id)}
                  >
                    <path d={segment.d} fill={segment.color} fillRule="evenodd" />
                  </g>
                );
              })}
            </svg>
            <p
              data-status-center
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center"
            >
              <span className="text-[28px] leading-none font-semibold tracking-[-0.03em] text-ink tabular-nums">
                {active ? `${sharePercent(active.count, total)} %` : formatInteger(total)}
              </span>
              <span className="mt-1 max-w-[5.75rem] text-[12px] leading-tight text-balance text-ink-subtle">
                {active ? active.label : 'dossiers'}
              </span>
            </p>
          </div>
          <ul className="m-0 flex w-full list-none flex-col gap-1 p-0">
            {slices.map((slice) => (
              <li key={slice.id}>
                <StatusLegendRow
                  slice={slice}
                  share={sharePercent(slice.count, total)}
                  active={activeId === slice.id}
                  onEnter={() => pointAt(slice.id)}
                  onLeave={() => leave(slice.id)}
                  onFocus={() => focusAt(slice.id)}
                  onBlur={() => blurAt(slice.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function StatusLegendRow({
  slice,
  share,
  active,
  onEnter,
  onLeave,
  onFocus,
  onBlur,
}: {
  slice: Slice;
  share: number;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const className =
    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-(--ui-dur-press) ease-(--ui-ease-out) motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';
  const style = {
    backgroundColor: active ? `color-mix(in srgb, ${slice.color} 12%, var(--color-surface))` : 'transparent',
  };
  const events = {
    onMouseEnter: onEnter,
    onMouseLeave: onLeave,
    onFocus,
    onBlur,
  };
  const body = (
    <>
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{slice.label}</span>
      <span className="shrink-0 text-right text-[13px] text-ink-subtle tabular-nums">
        <span className="mr-3">{share} %</span>
        {formatInteger(slice.count)}
      </span>
    </>
  );
  if (slice.href) {
    return (
      <Link href={slice.href} data-active={active ? 'true' : 'false'} className={className} style={style} {...events}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      data-active={active ? 'true' : 'false'}
      className={`${className} cursor-pointer border-0 bg-transparent font-inherit`}
      style={style}
      {...events}
    >
      {body}
    </button>
  );
}

function TopProcedures({ dashboard }: { dashboard: Dashboard }) {
  const rows = dashboard.metrics.topProcedures;
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <h2 className="text-[17px] leading-tight font-semibold tracking-[-0.02em] text-ink">Démarches les plus demandées</h2>
      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-ink-muted">Aucune demande sur la période.</p>
      ) : (
        <ol className="m-0 mt-6 flex list-none flex-col gap-5 p-0">
          {rows.map((entry, index) => {
            const share = total > 0 ? Math.round((entry.count / total) * 100) : 0;
            return (
              <li key={entry.procedureId} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="min-w-0 text-sm text-ink">
                    <span className="mr-2 font-mono text-[12px] text-ink-subtle tabular-nums">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {entry.title}
                  </p>
                  <p className="shrink-0 text-[13px] text-ink-subtle tabular-nums">
                    {formatInteger(entry.count)}
                    <span className="ml-2">{share} %</span>
                  </p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(share, 4)}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

type QueueTab = 'all' | 'pending' | 'completed';

function RecentQueue({ administrationId }: { administrationId: string | undefined }) {
  const { officialName } = useConsole();
  const [tab, setTab] = useState<QueueTab>('pending');
  const load = useCallback(async () => {
    const [pending, completed] = await Promise.all([
      adminApi.listCases({ administrationId, view: 'pending', limit: RECENT_LIMIT }),
      adminApi.listCases({ administrationId, view: 'completed', limit: RECENT_LIMIT }),
    ]);
    return { pending: pending.items, completed: completed.items };
  }, [administrationId]);
  const { data, status, error, reload } = useRemote<{ pending: Case[]; completed: Case[] }>(load);

  const [query, setQuery] = useState('');
  const pending = data?.pending ?? [];
  const completed = data?.completed ?? [];
  const items = useMemo(() => {
    if (tab === 'completed') return completed;
    if (tab === 'pending') return pending;
    return [...pending, ...completed];
  }, [tab, pending, completed]);

  if (status === 'loading' && !data) return <Skeleton lines={4} />;
  if (status === 'error') return <RemoteError error={error} noun="les dossiers" onRetry={reload} />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="flex shrink-0 items-center gap-3 text-[17px] leading-tight font-semibold tracking-[-0.02em] text-ink">
          <Link href="/admin/complete" className="cursor-pointer no-underline hover:underline">
            Dossiers récents
          </Link>
          <span className="relative inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full bg-sunken px-2 text-sm leading-none font-semibold tracking-normal text-ink tabular-nums">
            <span className="sr-only"> </span>
            {items.length}
          </span>
        </h2>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
          <QueueSearch query={query} onQueryChange={setQuery} />
          <QueueChipRow
            chips={[
              { key: 'all', label: 'Tous', active: tab === 'all', onClick: () => setTab('all') },
              { key: 'pending', label: 'En attente', active: tab === 'pending', onClick: () => setTab('pending') },
              { key: 'completed', label: 'Complété', active: tab === 'completed', onClick: () => setTab('completed') },
            ]}
          />
        </div>
      </div>
      <CaseQueue items={items} label="Dossiers récents" officialName={officialName} query={query} />
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
      <div className="flex flex-col gap-6">
        {status === 'loading' && !dashboard ? <Skeleton lines={2} /> : null}
        {status === 'error' ? <RemoteError error={error} noun="les indicateurs" onRetry={reload} /> : null}
        {dashboard ? <Kpis dashboard={dashboard} /> : null}
        {dashboard ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <TopProcedures dashboard={dashboard} />
            <StatusDonut dashboard={dashboard} canReadCases={canReadCases} />
          </div>
        ) : null}
        {canReadCases ? <RecentQueue administrationId={administrationId} /> : null}
      </div>
    </>
  );
}

export function WorkOverview() {
  return <AdministrationGate header={HEADER}>{(administrationId) => <Overview administrationId={administrationId} />}</AdministrationGate>;
}
