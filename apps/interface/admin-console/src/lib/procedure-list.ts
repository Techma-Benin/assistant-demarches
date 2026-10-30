import type { Procedure } from './c3-client';

/** Beyond this age, the source of a fiche must be checked again. */
export const STALE_AFTER_DAYS = 90;

const DAY = 24 * 60 * 60 * 1000;

export type StatusFilter = 'all' | 'validated' | 'draft';

/** Whole days since `retrievedAt`; null when the date is unparsable. */
export function sourceAgeDays(retrievedAt: string, now: Date): number | null {
  const time = new Date(retrievedAt).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((now.getTime() - time) / DAY));
}

export function isStaleSource(retrievedAt: string, now: Date): boolean {
  const age = sourceAgeDays(retrievedAt, now);
  return age !== null && age > STALE_AFTER_DAYS;
}

/** « il y a 12 jours », « aujourd’hui ». */
export function formatSourceAge(retrievedAt: string, now: Date): string {
  const age = sourceAgeDays(retrievedAt, now);
  if (age === null) return 'date inconnue';
  if (age === 0) return 'aujourd’hui';
  return `il y a ${age} jour${age > 1 ? 's' : ''}`;
}

export const parseStatusFilter = (value: string | undefined): StatusFilter =>
  value === 'validated' || value === 'draft' ? value : 'all';

export interface ProcedureFilters {
  query: string;
  status: StatusFilter;
  stale: boolean;
}

/** Client-side filtering of the loaded fiches (title or id for the search). */
export function filterProcedures(items: Procedure[], { query, status, stale }: ProcedureFilters, now: Date): Procedure[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (status !== 'all' && item.validationStatus !== status) return false;
    if (stale && !isStaleSource(item.source.retrievedAt, now)) return false;
    if (needle && !item.title.toLowerCase().includes(needle) && !item.id.toLowerCase().includes(needle)) return false;
    return true;
  });
}
