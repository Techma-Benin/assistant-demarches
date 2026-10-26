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
