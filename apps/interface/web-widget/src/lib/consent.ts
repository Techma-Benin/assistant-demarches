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
  resume: () => void;
}

export const noopConsent: ConsentControls = {
  flow: idleFlow,
  accept: () => {},
  refuse: () => {},
  renew: () => {},
  retry: () => {},
  retract: () => {},
  resume: () => {},
};

/** « HH:MM » in the reader's local time. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Dossier-panel step state: undefined = no consent requested yet. */
export function consentStepState(flow: ConsentFlow): 'pending' | 'active' | undefined {
  if (flow.phase === 'idle') return undefined;
  return flow.phase === 'active' || flow.phase === 'revoking' ? 'active' : 'pending';
}
