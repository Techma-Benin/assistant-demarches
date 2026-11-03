const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** `HH:mm` (fr-FR, local time) of an ISO date; empty when the date is invalid. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : TIME.format(date);
}

/** Local calendar day as `YYYY-MM-DD`; empty when the date is invalid. */
export function dayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const DAY_FORMAT_YEAR = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** « Aujourd’hui », « Hier » or « lundi 2 novembre » (year only when not the current one); empty when invalid. */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const key = dayKey(iso);
  if (!key) return '';
  if (key === dayKey(now.toISOString())) return 'Aujourd’hui';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === dayKey(yesterday.toISOString())) return 'Hier';
  const date = new Date(iso);
  return (date.getFullYear() === now.getFullYear() ? DAY_FORMAT : DAY_FORMAT_YEAR).format(date);
}

/** « à l’instant », « il y a 5 min », « il y a 2 h », else « à 14:32 » (today) or the day label; empty when invalid. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  if (dayKey(iso) === dayKey(now.toISOString())) return `à ${formatTime(iso)}`;
  return formatDayLabel(iso, now).toLowerCase();
}
