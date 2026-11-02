import type { ActivityEntry, Case, CaseAction, CaseStatus, CaseStep, CaseView, UnansweredEntry } from './api';
import { formatInteger } from './format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Median processing time given in hours: « 2 j 4 h », « 3 h », « 45 min », « - » when unknown. */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return '-';
  const ms = hours * HOUR;
  if (ms >= DAY) {
    const days = Math.floor(ms / DAY);
    const rest = Math.floor((ms % DAY) / HOUR);
    return rest > 0 ? `${formatInteger(days)} j ${rest} h` : `${formatInteger(days)} j`;
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
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (typeof value === 'string') return value;
  return String(value);
}

export const STATUS_LABELS: Record<CaseStatus, string> = {
  awaiting_payment: 'Paiement en attente',
  received: 'Reçu',
  in_review: 'En vérification',
  information_requested: 'Complément demandé',
  completed: 'Complété',
  rejected: 'Rejeté',
};

/** Console tabs (§8): En attente = received, in_review, information_requested. `awaiting_payment` only shows in `all`. */
export const CASE_TABS = [
  {
    slug: 'en-attente',
    view: 'pending',
    title: 'En attente',
    noun: 'les dossiers en attente',
    description: 'Les dossiers déposés qui attendent une vérification ou un complément de l’usager.',
    empty: 'Aucun dossier en attente',
    statuses: ['received', 'in_review', 'information_requested'],
  },
  {
    slug: 'complete',
    view: 'completed',
    title: 'Complété',
    noun: 'les dossiers complétés',
    description: 'Les dossiers terminés, par l’assistant ou par un agent.',
    empty: 'Aucun dossier complété',
    statuses: ['completed'],
  },
  {
    slug: 'rejete',
    view: 'rejected',
    title: 'Rejeté',
    noun: 'les dossiers rejetés',
    description: 'Les dossiers refusés par l’administration, avec leur motif.',
    empty: 'Aucun dossier rejeté',
    statuses: ['rejected'],
  },
] as const satisfies ReadonlyArray<{
  slug: string;
  view: CaseView;
  title: string;
  noun: string;
  description: string;
  empty: string;
  statuses: readonly CaseStatus[];
}>;

export type CaseTab = (typeof CASE_TABS)[number];

export const tabFor = (view: CaseView): CaseTab | undefined => CASE_TABS.find((tab) => tab.view === view);

/** The tab a case lives in; `awaiting_payment` has none (listed in `view=all` only). */
export const tabOfStatus = (status: CaseStatus): CaseTab | undefined =>
  CASE_TABS.find((tab) => (tab.statuses as readonly CaseStatus[]).includes(status));

export function completedByLabel(item: Pick<Case, 'completedBy'>): string | null {
  if (item.completedBy === 'assistant') return 'par l’assistant';
  if (item.completedBy === 'administration') return 'par l’administration';
  return null;
}

/** Actions an agent may take, by status (§8). The server decides in the end. */
export function allowedActions(status: CaseStatus): CaseAction[] {
  const actions: CaseAction[] = [];
  if (status === 'received' || status === 'in_review') actions.push('claim');
  if (status === 'in_review') actions.push('request_information', 'approve');
  if (status === 'in_review' || status === 'information_requested') actions.push('reject');
  return actions;
}

/** Actions that need a non-empty note; the others send `note: null`. */
export const NOTE_ACTIONS: readonly CaseAction[] = ['request_information', 'reject'];

export const ACTION_SUCCESS: Record<CaseAction, string> = {
  claim: 'Dossier pris en charge.',
  request_information: 'Demande de complément envoyée.',
  approve: 'Dossier approuvé.',
  reject: 'Dossier rejeté.',
};

export const PAYMENT_LABELS: Record<string, string> = {
  not_required: 'Aucun paiement requis',
  pending: 'Paiement en attente',
  paid: 'Payé',
};

export const CHANNEL_LABELS: Record<string, string> = { whatsapp: 'WhatsApp', web: 'Web' };

export const ACTOR_LABELS: Record<CaseStep['actor'], string> = {
  assistant: 'Assistant',
  applicant: 'Usager',
  administration: 'Administration',
};

export const STEP_STATE_LABELS: Record<CaseStep['state'], string> = {
  done: 'Fait',
  blocked: 'Intervention requise',
  pending: 'À venir',
};

export const ACTIVITY_LABELS: Record<ActivityEntry['action'], string> = {
  'case.created': 'Dossier créé',
  'case.paid': 'Frais payés',
  'step.completed': 'Étape terminée',
  'case.claimed': 'Dossier pris en charge',
  'information.requested': 'Complément demandé',
  'information.provided': 'Complément fourni',
  'case.approved': 'Dossier approuvé',
  'case.rejected': 'Dossier rejeté',
  'document.issued': 'Document délivré',
};

export const UNANSWERED_REASONS: Record<UnansweredEntry['reason'], string> = {
  no_procedure_found: 'Aucune démarche trouvée',
  no_source: 'Aucune source disponible',
  model_unavailable: 'Assistant indisponible',
  tool_failed: 'Un outil a échoué',
};

/** « Agent 3F7K2M » when the name is unknown (no `officials:read`). */
export const anonymousOfficial = (officialId: string): string => `Agent ${officialId.slice(-6)}`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${formatInteger(Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

/** Who did it, for a journal entry: an official by name, otherwise the assistant, the user or « Administration ». */
export function activityActor(entry: Pick<ActivityEntry, 'actor' | 'officialId'>, officialName: (id: string) => string): string {
  if (entry.officialId) return officialName(entry.officialId);
  return ACTOR_LABELS[entry.actor];
}
