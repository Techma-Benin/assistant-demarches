import type { AdminWorkItem, RequestStatus, WorkAction } from './department-api';
import { formatInteger } from './format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Median processing time: « 2 j 4 h », « 3 h », « 45 min », « - » when unknown. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '-';
  if (ms >= DAY) {
    const days = Math.floor(ms / DAY);
    const hours = Math.floor((ms % DAY) / HOUR);
    return hours > 0 ? `${formatInteger(days)} j ${hours} h` : `${formatInteger(days)} j`;
  }
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)} h`;
  if (ms >= MINUTE) return `${Math.floor(ms / MINUTE)} min`;
  return '< 1 min';
}

/** « 30 derniers jours » from the dashboard period. */
export function formatPeriod(period: { from: string; to: string }): string {
  const days = Math.round((new Date(period.to).getTime() - new Date(period.from).getTime()) / DAY);
  if (!Number.isFinite(days) || days <= 0) return 'Période sélectionnée';
  return days === 1 ? 'Dernier jour' : `${days} derniers jours`;
}

/** « nomComplet » / « nom_complet » → « Nom complet ». */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: 'Brouillon',
  ready: 'Prêt',
  awaiting_user_validation: 'En attente de l’usager',
  submitted: 'À vérifier',
  processing: 'En cours',
  completed: 'Complété',
  rejected: 'Rejeté',
  cancelled: 'Annulé',
  blocked: 'Bloqué',
};

/** Short state phrase of a list row: « nouvelle demande · à vérifier », « en cours », « bloqué · motif ». */
export function statePhrase(item: AdminWorkItem): string {
  switch (item.status) {
    case 'submitted':
      return 'nouvelle demande · à vérifier';
    case 'processing':
      return item.assignedTo ? `en cours · pris en charge par ${item.assignedTo}` : 'en cours';
    case 'blocked':
      return item.blocking?.detail ? `bloqué · ${item.blocking.detail}` : 'bloqué';
    default:
      return STATUS_LABELS[item.status].toLowerCase();
  }
}

export function completedByLabel(item: Pick<AdminWorkItem, 'completedBy'>): string | null {
  if (item.completedBy === 'ai') return 'par l’IA';
  if (item.completedBy === 'human') return 'par un agent';
  return null;
}

export const isOverdue = (item: AdminWorkItem, now: Date = new Date()): boolean =>
  Boolean(item.dueAt) &&
  ['submitted', 'processing', 'blocked'].includes(item.status) &&
  new Date(item.dueAt!).getTime() < now.getTime();

/** Actions an agent may take, by status. */
export function allowedActions(status: RequestStatus): WorkAction[] {
  switch (status) {
    case 'submitted':
      return ['claim'];
    case 'processing':
      return ['request_information', 'approve', 'reject'];
    case 'blocked':
      return ['resume'];
    default:
      return [];
  }
}

export const ACTION_SUCCESS: Record<WorkAction, string> = {
  claim: 'Dossier pris en charge.',
  request_information: 'Demande d’information envoyée.',
  approve: 'Dossier validé.',
  reject: 'Dossier rejeté.',
  resume: 'Dossier repris.',
};

export const PAYMENT_LABELS: Record<string, string> = {
  not_required: 'Aucun paiement requis',
  pending: 'Paiement en attente',
  paid: 'Payé',
  failed: 'Paiement échoué',
  cancelled: 'Paiement annulé',
  refunded: 'Remboursé',
};

export const EVIDENCE_SOURCES: Record<string, string> = {
  user: 'saisi par l’usager',
  document: 'lu dans un document',
  registry: 'registre officiel',
};

export const CHANNEL_LABELS: Record<string, string> = { whatsapp: 'WhatsApp', web: 'Web', mobile: 'Mobile' };
