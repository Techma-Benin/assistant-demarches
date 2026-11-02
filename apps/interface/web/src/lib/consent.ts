import type { Schemas } from '@techma/contracts-ts';

export type Challenge = Schemas['Challenge'];

/**
 * Per challenge (`consent` block, built by the Backend): what the card shows. The contract has no « refuse » call
 * (`ConsentInput.accepted` is `true` only), so a refusal stays local: the challenge is simply never accepted.
 */
export type ConsentState =
  | { phase: 'pending' }
  | { phase: 'accepting' }
  | { phase: 'accepted' }
  | { phase: 'refused' }
  /** Challenge consumed or no longer valid server-side (403/404/409). */
  | { phase: 'invalid' }
  | { phase: 'error'; message: string };

export const pendingConsent: ConsentState = { phase: 'pending' };

export interface ConsentControls {
  /** State of each challenge by id; a challenge not listed is `pending`. */
  states: Record<string, ConsentState>;
  accept: (challenge: Challenge) => void;
  refuse: (challenge: Challenge) => void;
}

export const noopConsent: ConsentControls = {
  states: {},
  accept: () => {},
  refuse: () => {},
};

/**
 * What the assistant never does, whatever the scopes: no NPI or SMS code in the chat (CONTRACTS.md §6),
 * no payment (product rule: the user pays on the payment aggregator; the Tooling's `request.pay` still
 * contradicts it, see the Backend meeting notes), and no action without a granted mandate.
 * Used by the home page; the chat shows the server `consentText` only.
 */
export const NEVER_DO = ['vous demander votre NPI ou un code SMS dans la conversation', 'payer à votre place', 'agir sans votre accord'] as const;
