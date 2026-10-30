'use client';

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  cn,
} from '@techma/ui';
import { useState } from 'react';
import { CHANNELS, type Channel, type DayChannelCount } from '@/lib/dashboard-data';
import { formatConversations, formatInteger, formatLongDay, formatShortDay } from '@/lib/format';

export const CHANNEL_LABEL: Record<Channel, string> = { web: 'Web', whatsapp: 'WhatsApp', mobile: 'Mobile' };
// Colour follows the entity, never its rank.
const CHANNEL_VIZ: Record<Channel, string> = { web: 'bg-viz-1', whatsapp: 'bg-viz-2', mobile: 'bg-viz-3' };
const CHANNEL_FILL: Record<Channel, string> = { web: 'fill-viz-1', whatsapp: 'fill-viz-2', mobile: 'fill-viz-3' };

const tooltipClass =
  'pointer-events-none absolute z-10 rounded-field border border-line bg-surface px-3 py-1.5 text-sm whitespace-nowrap text-ink shadow-(--ui-shadow-pop)';

/** Keeps the tooltip inside its chart: anchored on its left or right edge near the sides, centred elsewhere. */
function tooltipAnchor(fraction: number): string {
  if (fraction > 0.75) return '-translate-x-full';
  if (fraction < 0.25) return 'translate-x-0';
  return '-translate-x-1/2';
}

/** Smallest even "nice" number ≥ max (min 4), so that the mid gridline is an integer. */
export function niceMax(max: number): number {
  const target = Math.max(4, max);
  for (let power = 1; ; power *= 10) {
    for (const step of [1, 2, 4, 6, 8, 10]) {
      if (step * power >= target) return step * power;
    }
  }
}

const W = 560;
const H = 220;
const M = { top: 20, right: 8, bottom: 28, left: 32 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const BASE = M.top + PLOT_H;

const GAP = 2;

export function DailyChart({ days, partialCap }: { days: DayChannelCount[]; partialCap?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const total = days.reduce((sum, day) => sum + day.count, 0);

  if (total === 0) {
    return <p className="py-8 text-center text-sm text-ink-muted">Aucune conversation sur les 14 derniers jours.</p>;
  }

  const peak = days.reduce((best, day) => (day.count > best.count ? day : best), days[0]);
  const yMax = niceMax(peak.count);
  const band = PLOT_W / days.length;
  const barWidth = Math.min(24, band * 0.6);
  const lastNonZero = days.reduce((last, day, index) => (day.count > 0 ? index : last), -1);
  const y = (value: number) => BASE - (value / yMax) * PLOT_H;
  const label = `Histogramme empilé des conversations sur ${days.length} jours par canal (web, WhatsApp, mobile) : ${formatInteger(total)} au total, jour le plus actif ${formatLongDay(peak.date)} (${formatInteger(peak.count)}).`;
  const tooltipDay = active === null ? null : days[active];

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block h-auto w-full">
          {[yMax / 2, yMax].map((tick) => (
            <line key={tick} x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} className="stroke-line" strokeWidth={1} />
          ))}
          {[0, yMax / 2, yMax].map((tick) => (
            <text key={tick} x={M.left - 6} y={y(tick) + 4} textAnchor="end" fontSize={12} className="fill-ink-muted">
              {tick}
            </text>
          ))}
          <line x1={M.left} x2={W - M.right} y1={BASE} y2={BASE} className="stroke-line-strong" strokeWidth={1} />
          {days.map((day, index) => {
            const x = M.left + index * band;
            const center = x + band / 2;
            return (
              <g key={day.key}>
                <rect
                  x={x}
                  y={M.top}
                  width={band}
                  height={PLOT_H}
                  rx={4}
                  className={cn('transition-colors duration-(--ui-dur-fast)', active === index ? 'fill-sunken' : 'fill-transparent')}
                />
                {CHANNELS.map((channel, channelIndex) => {
                  const below = CHANNELS.slice(0, channelIndex).reduce((sum, c) => sum + day.channels[c], 0);
                  const segment = (day.channels[channel] / yMax) * PLOT_H;
                  if (segment <= 0) return null;
                  return (
                    <rect
                      key={channel}
                      x={center - barWidth / 2}
                      y={BASE - (below / yMax) * PLOT_H - segment}
                      width={barWidth}
                      height={Math.max(segment - GAP, 1)}
                      rx={3}
                      className={CHANNEL_FILL[channel]}
                    />
                  );
                })}
                {index === lastNonZero ? (
                  <text x={center} y={y(day.count) - 6} textAnchor="middle" fontSize={12} fontWeight={600} className="fill-ink">
                    {day.count}
                  </text>
                ) : null}
                {(days.length - 1 - index) % 3 === 0 ? (
                  <text x={center} y={H - 8} textAnchor="middle" fontSize={12} className="fill-ink-muted">
                    {formatShortDay(day.date)}
                  </text>
                ) : null}
                <rect
                  data-testid="day-hit"
                  x={x}
                  y={M.top}
                  width={band}
                  height={PLOT_H}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${formatLongDay(day.date)} : ${formatConversations(day.count)}`}
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
        {tooltipDay && active !== null ? (
          <div
            role="tooltip"
            className={cn(tooltipClass, tooltipAnchor((M.left + active * band + band / 2) / W))}
            style={{
              left: `${((M.left + active * band + band / 2) / W) * 100}%`,
              top: `${(Math.max(0, y(tooltipDay.count) - 48) / H) * 100}%`,
            }}
          >
            {formatLongDay(tooltipDay.date)} · {formatConversations(tooltipDay.count)}
          </div>
        ) : null}
      </div>

      <ul aria-label="Légende des canaux" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold">
        {CHANNELS.map((channel) => (
          <li key={channel} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('size-[11px] shrink-0 rounded-[3px]', CHANNEL_VIZ[channel])} />
            {CHANNEL_LABEL[channel]}
          </li>
        ))}
      </ul>

      {partialCap !== undefined ? (
        <p className="text-sm text-ink-muted">Calculé sur les {formatInteger(partialCap)} conversations chargées.</p>
      ) : null}

      <div>
        <Button variant="ghost" size="sm" aria-expanded={showTable} onClick={() => setShowTable((value) => !value)}>
          {showTable ? 'Masquer le tableau' : 'Voir le tableau'}
        </Button>
      </div>
      {showTable ? (
        <div className="overflow-x-auto">
          <Table aria-label="Conversations par jour">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Jour</TableHeaderCell>
                {CHANNELS.map((channel) => (
                  <TableHeaderCell key={channel}>{CHANNEL_LABEL[channel]}</TableHeaderCell>
                ))}
                <TableHeaderCell>Total</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {days.map((day) => (
                <TableRow key={day.key}>
                  <TableCell>{formatLongDay(day.date)}</TableCell>
                  {CHANNELS.map((channel) => (
                    <TableCell key={channel}>{formatInteger(day.channels[channel])}</TableCell>
                  ))}
                  <TableCell>{formatInteger(day.count)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
