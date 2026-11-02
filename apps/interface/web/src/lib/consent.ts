import type { components } from '@techma/contracts-ts';
import type { Challenge } from './c1-client';
import type { ConversationState } from './conversation-state';

type Schemas = components['schemas'];
export type Scope = Schemas['Scope'];

/**
 * Scopes requested in ONE consent for the whole preparation: the union of the scopes of every
 * mandate-requiring tool in `contracts/v1/mcp.tools.json` (`bj.techma/scopes`):
 * request.create/update -> requests:write, documents.attach -> documents:write, request.submit/pay -> requests:submit.
 * INTERIM: pending the Backend answer to docs/contract-question-consent-trigger.md. The server `consentText`
 * lists each action in plain words, so the user sees exactly what is granted.
 */
export const MANDATE_SCOPES: Scope[] = ['requests:write', 'documents:write', 'requests:submit'];

/** `tool.called` error codes (set by Backend code, not by the model) that mean "a mandate is needed". */
export const MANDATE_TRIGGER_CODES = ['MANDATE_MISSING', 'MANDATE_EXPIRED', 'MANDATE_REVOKED'] as const;
export type MandateTriggerCode = (typeof MANDATE_TRIGGER_CODES)[number];

export function isMandateTriggerCode(code: string): code is MandateTriggerCode {
  return (MANDATE_TRIGGER_CODES as readonly string[]).includes(code);
}

/**
 * Procedure to ask the mandate for, from data the Backend validated: the procedure of the latest
 * `request.created` event, else of the latest Source in the agent's text blocks, else null.
 */
export function resolveProcedureId(state: Pick<ConversationState, 'requestProcedureId' | 'timeline'>): string | null {
  if (state.requestProcedureId) return state.requestProcedureId;
  for (let i = state.timeline.length - 1; i >= 0; i--) {
    const entry = state.timeline[i];
    if (entry.kind !== 'agent') continue;
    for (let b = entry.message.blocks.length - 1; b >= 0; b--) {
      const block = entry.message.blocks[b];
      if (block.type === 'text' && block.sources.length > 0) return block.sources[block.sources.length - 1].procedureId;
    }
  }
  return null;
}

/** Challenge as kept in React state: the opaque `proofToken` and `userRef` are dropped. */
export type PublicChallenge = Pick<Challenge, 'id' | 'procedureId' | 'scopes' | 'consentText' | 'expiresAt'>;

export function toPublicChallenge(challenge: Challenge): PublicChallenge {
  const { id, procedureId, scopes, consentText, expiresAt } = challenge;
  return { id, procedureId, scopes, consentText, expiresAt };
}

export type ConsentFlow =
  | { phase: 'idle' }
  | { phase: 'noProcedure' }
  | { phase: 'requesting' }
  | { phase: 'pending'; challenge: PublicChallenge }
  | { phase: 'accepting'; challenge: PublicChallenge }
  | { phase: 'active'; mandate: { id: string; expiresAt: string } }
  | { phase: 'revoking'; mandate: { id: string; expiresAt: string } }
  | { phase: 'refused' }
  | { phase: 'revoked' }
  /** Challenge consumed or expired server-side (403/409). */
  | { phase: 'invalid' }
  | { phase: 'error'; message: string; during: 'challenge' | 'accept' | 'revoke' };

export const idleFlow: ConsentFlow = { phase: 'idle' };

export interface ConsentControls {
  flow: ConsentFlow;
  accept: () => void;
  refuse: () => void;
  /** New challenge (« Changer d’avis », « Demander à nouveau »). */
  renew: () => void;
  /** Retry after a network/server error, reusing the Idempotency-Key of the failed attempt. */
  retry: () => void;
  retract: () => void;
}

export const noopConsent: ConsentControls = {
  flow: idleFlow,
  accept: () => {},
  refuse: () => {},
  renew: () => {},
  retry: () => {},
  retract: () => {},
};

/** « HH:MM » in the reader's local time. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** « samedi 31 octobre à 16:19 » in the reader's local time; the year is added only when it is not the current one. */
export function formatExpiry(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const day = [get('weekday'), get('day'), get('month'), get('year')].filter(Boolean).join(' ');
  return `${day} à ${get('hour')}:${get('minute')}`;
}

/** « jusqu’à 21:05 » when the expiry is today (local), else « jusqu’au dimanche 2 novembre à 09:00 ». */
export function formatExpiryShort(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return sameDay ? `jusqu’à ${formatTime(iso)}` : `jusqu’au ${formatExpiry(iso, now)}`;
}

const SCOPE_LABELS: Partial<Record<Scope, string>> = {
  'requests:write': 'créer et remplir votre demande',
  'documents:write': 'joindre vos pièces à la demande',
  // Product rule: the user always pays on the payment aggregator; the assistant only files the request.
  'requests:submit': 'déposer votre demande',
};

/** What the assistant may do for these scopes, in plain French; unknown scopes are skipped. */
export function scopeLabels(scopes: readonly string[]): string[] {
  return scopes.flatMap((scope) => SCOPE_LABELS[scope as Scope] ?? []);
}

/**
 * What the assistant never does, whatever the scopes: no NPI or SMS code in the chat (CONTRACTS.md §6),
 * no payment (product rule: the user pays on the payment aggregator; the Tooling's `request.pay` still
 * contradicts it, see the Backend meeting notes), and no action without a granted mandate.
 */
export const NEVER_DO = ['vous demander votre NPI ou un code SMS dans la conversation', 'payer à votre place', 'agir sans votre accord'] as const;

/** Dossier-panel step state: undefined = no consent requested yet. */
export function consentStepState(flow: ConsentFlow): 'pending' | 'active' | undefined {
  if (flow.phase === 'idle') return undefined;
  return flow.phase === 'active' || flow.phase === 'revoking' ? 'active' : 'pending';
}
