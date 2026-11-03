import type { Schemas } from '@techma/contracts-ts';

export type Case = Schemas['Case'];
export type CaseStatus = Schemas['CaseStatus'];
export type CasePayment = Schemas['CasePayment'];

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  awaiting_payment: 'En attente de paiement',
  received: 'Dossier reçu',
  in_review: 'En cours d’examen',
  information_requested: 'Complément demandé',
  completed: 'Terminé',
  rejected: 'Rejeté',
};

export type CasePill = 'validated' | 'draft' | 'toValidate' | 'submitted' | 'info' | 'danger';

export const CASE_STATUS_PILL: Record<CaseStatus, CasePill> = {
  awaiting_payment: 'toValidate',
  received: 'submitted',
  in_review: 'info',
  information_requested: 'toValidate',
  completed: 'validated',
  rejected: 'danger',
};

const fcfa = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** « 1 900 FCFA » (amounts are whole FCFA). */
export function formatFcfa(amount: number): string {
  return `${fcfa.format(amount)} FCFA`;
}

/** What the payment of a case says, never more: « 1 900 FCFA, payé (simulé) ». */
export function paymentSummary(payment: CasePayment): string {
  const simulated = payment.simulated ? ' (simulé)' : '';
  if (payment.status === 'not_required') return `Aucun paiement requis${simulated}`;
  const amount = formatFcfa(payment.amountFcfa);
  return payment.status === 'paid' ? `${amount}, payé${simulated}` : `${amount}, à payer${simulated}`;
}

/** The contract gives an administration id only (e.g. `justice`): shown readable, capitalised. */
export function administrationLabel(administrationId: string): string {
  const words = administrationId.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const issuedDocuments = (item: Case) => item.documents.filter((document) => document.kind === 'issued');

export { formatDateFr } from './safe-url';
