import { formatDateTime } from './format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** « à l’instant », « il y a 5 min », « il y a 3 h », « hier », « il y a 4 jours » ; la date courte au-delà d’une semaine. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;
  const elapsed = now.getTime() - time;
  if (elapsed < 0) return formatDateTime(iso);
  if (elapsed < MINUTE) return 'à l’instant';
  if (elapsed < HOUR) return `il y a ${Math.floor(elapsed / MINUTE)} min`;
  if (elapsed < DAY) return `il y a ${Math.floor(elapsed / HOUR)} h`;
  const days = Math.floor(elapsed / DAY);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return formatDateTime(iso);
}
