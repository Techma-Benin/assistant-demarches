'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, InlineAlert, Tile } from '@techma/ui';
import { ShieldCheck } from 'lucide-react';
import { pendingConsent, type Challenge, type ConsentControls } from '@/lib/consent';

const BUTTON = 'min-h-11';
const MAX_TIMEOUT = 2 ** 31 - 1;

/** True once `expiresAt` has passed; flips by itself at that moment. */
function useExpired(expiresAt: string, now: () => number): boolean {
  const target = new Date(expiresAt).getTime();
  const [expired, setExpired] = useState(() => now() >= target);
  useEffect(() => {
    const remaining = target - now();
    if (remaining <= 0) {
      setExpired(true);
      return;
    }
    setExpired(false);
    if (!Number.isFinite(remaining)) return;
    const timer = setTimeout(() => setExpired(true), Math.min(remaining, MAX_TIMEOUT));
    return () => clearTimeout(timer);
  }, [target, now]);
  return expired;
}

const realNow = () => Date.now();

/**
 * Consent card of a `consent` block. The server `consentText` is rendered as plain text (never HTML) and
 * nothing else describes the mandate; `proofToken` and `userRef` are never displayed.
 */
export function ConsentCard({
  challenge,
  consent,
  interactive = true,
  now = realNow,
}: {
  challenge: Challenge;
  consent: ConsentControls;
  /** False for an older message: the card stays readable but can't be answered. */
  interactive?: boolean;
  /** Clock, injectable in tests. */
  now?: () => number;
}) {
  const state = consent.states[challenge.id] ?? pendingConsent;
  const expired = useExpired(challenge.expiresAt, now);
  const actionable = (state.phase === 'pending' || state.phase === 'error') && !expired && interactive;

  // Move focus to the title (never to « J’autorise ») when the card appears, unless the user is typing.
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!actionable || !interactive) return;
    const active = document.activeElement;
    const typing =
      active instanceof HTMLElement &&
      (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable);
    if (!typing) title.current?.focus();
  }, [actionable, interactive]);

  let outcome: string | null = null;
  if (state.phase === 'accepted') outcome = 'Autorisation accordée.';
  else if (state.phase === 'refused') outcome = 'Autorisation refusée. L’assistant ne fera aucune démarche à votre place.';
  else if (state.phase === 'invalid') outcome = 'Cette autorisation n’est plus valable.';
  else if (expired && state.phase !== 'accepting') outcome = 'Cette demande d’autorisation a expiré.';

  const done = state.phase === 'accepted';
  return (
    <Tile
      tone="outline"
      role="region"
      aria-label="Autorisation demandée"
      className="flex flex-col gap-4 rounded-[24px] p-6 shadow-[0_1px_2px_rgb(13_13_15/0.04),0_12px_32px_-12px_rgb(13_13_15/0.16)] md:p-7"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex size-10 shrink-0 items-center justify-center rounded-full ${done ? 'bg-trust-soft text-trust-text' : outcome ? 'bg-sunken text-ink' : 'bg-sun text-ink'}`}
        >
          <ShieldCheck className="size-5" />
        </span>
        <h2
          ref={title}
          tabIndex={-1}
          className="m-0 font-display text-[24px] font-extrabold leading-[1.15] tracking-[-0.02em] outline-none"
        >
          Autorisation
        </h2>
      </div>
      <p className="m-0 whitespace-pre-wrap break-words text-[15px] leading-[1.55]">{challenge.consentText}</p>
      {outcome !== null ? (
        <p className="m-0 text-[15px] font-semibold">
          {outcome}
        </p>
      ) : (
        <>
          {state.phase === 'error' && <InlineAlert>{state.message}</InlineAlert>}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="trust"
              className={BUTTON}
              disabled={!interactive || state.phase === 'accepting'}
              onClick={() => consent.accept(challenge)}
            >
              {state.phase === 'accepting' ? 'Enregistrement…' : 'J’autorise'}
            </Button>
            <Button
              variant="secondary"
              className={BUTTON}
              disabled={!interactive || state.phase === 'accepting'}
              onClick={() => consent.refuse(challenge)}
            >
              Refuser
            </Button>
          </div>
        </>
      )}
    </Tile>
  );
}
