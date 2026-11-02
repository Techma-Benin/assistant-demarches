const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export const formatInteger = (value: number): string => integer.format(value);

export const formatMs = (value: number): string => `${integer.format(value)} ms`;

/** Rate in [0, 1] shown as a percentage. */
export const formatRate = (value: number): string => percent.format(value);

export const formatFcfa = (value: number): string => (value === 0 ? 'Gratuit' : `${integer.format(value)} FCFA`);

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date);
}

/** Shortens an identifier for display; callers keep the full value in a `title`. */
export const shorten = (value: string, length: number): string =>
  value.length > length ? `${value.slice(0, length)}…` : value;

const percentRounded = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });

/** Share in [0, 1] shown as a whole percentage (« 67 % »). */
export const formatShare = (value: number): string => percentRounded.format(value);

const shortDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Local calendar day (same fields as the chart buckets), rendered in UTC so Intl cannot shift it. */
const calendarDay = (date: Date): Date => new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

/** « 26 oct. » */
export const formatShortDay = (date: Date): string => shortDay.format(calendarDay(date));

/** « dim. 26 oct. » */
export const formatLongDay = (date: Date): string => longDay.format(calendarDay(date));

/** « 1 conversation », « 6 conversations ». */
export const formatConversations = (count: number): string =>
  `${integer.format(count)} conversation${count > 1 ? 's' : ''}`;

const seconds = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Milliseconds shown in seconds with a French decimal comma (« 3,2 s »). */
export const formatSeconds = (ms: number): string => `${seconds.format(ms / 1000)} s`;

const temperatureFormat = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Model temperature with one decimal (« 0,3 »). */
export const formatTemperature = (value: number): string => temperatureFormat.format(value);
