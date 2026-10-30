'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, InlineAlert, Tile, TypingIndicator } from '@techma/ui';
import { ShieldCheck } from 'lucide-react';
import { formatTime, type ConsentControls } from '@/lib/consent';

const BUTTON = 'min-h-11';
const MAX_TIMEOUT = 2 ** 31 - 1;

/** True once `expiresAt` has passed; flips by itself at that moment. */
function useExpired(expiresAt: string | undefined, now: () => number): boolean {
  const target = expiresAt ? new Date(expiresAt).getTime() : Number.POSITIVE_INFINITY;
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

function Body({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[15px] leading-[1.55]">{children}</p>;
}

/**
 * Consent (mandate) card. The server `consentText` is rendered as plain text (never HTML);
 * `proofToken` and `userRef` never reach this component.
 */
export function ConsentCard({
  consent,
  now = realNow,
}: {
  consent: ConsentControls;
  /** Clock, injectable in tests. */
  now?: () => number;
}) {
  const { flow, accept, refuse, renew, retry, retract, resume } = consent;
  const challenge = flow.phase === 'pending' || flow.phase === 'accepting' ? flow.challenge : undefined;
  const mandate = flow.phase === 'active' || flow.phase === 'revoking' ? flow.mandate : undefined;
  const expired = useExpired(challenge?.expiresAt ?? mandate?.expiresAt, now);

  // Move focus to the primary action when the card appears, unless the user is typing.
  const actions = useRef<HTMLDivElement>(null);
  const actionable = flow.phase === 'pending' && !expired;
  useEffect(() => {
    if (!actionable) return;
    const active = document.activeElement;
    const typing =
      active instanceof HTMLElement &&
      (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable);
    if (!typing) actions.current?.querySelector('button')?.focus();
  }, [actionable]);

  if (flow.phase === 'idle') return null;

  let content: ReactNode;
  if (flow.phase === 'requesting') {
    content = (
      <div className="flex items-center gap-2 text-ink-muted">
        <TypingIndicator label="Préparation de la demande d’autorisation…" />
        <span aria-hidden="true">Préparation de la demande d’autorisation…</span>
      </div>
    );
  } else if (flow.phase === 'noProcedure') {
    content = <Body>L’assistant doit d’abord identifier la démarche. Précisez votre demande.</Body>;
  } else if (challenge && expired) {
    content = (
      <>
        <Body>Cette demande d’autorisation a expiré.</Body>
        <div className="flex flex-wrap gap-3">
          <Button className={BUTTON} onClick={renew}>
            Demander à nouveau
          </Button>
        </div>
      </>
    );
  } else if (challenge) {
    const busy = flow.phase === 'accepting';
    content = (
      <>
        <p className="m-0 whitespace-pre-wrap break-words text-[15px] leading-[1.55]">{challenge.consentText}</p>
        <p className="m-0 text-[13px] text-ink-muted">Valable jusqu’à {formatTime(challenge.expiresAt)}</p>
        <div ref={actions} className="flex flex-wrap gap-3">
          <Button variant="trust" className={BUTTON} disabled={busy} onClick={accept}>
            J’autorise
          </Button>
          <Button variant="secondary" className={BUTTON} disabled={busy} onClick={refuse}>
            Refuser
          </Button>
        </div>
        <p className="m-0 text-[13px] text-ink-muted">
          Vous pourrez retirer cette autorisation à tout moment, ou écrire STOP.
        </p>
      </>
    );
  } else if (mandate && expired) {
    content = (
      <>
        <Body>Autorisation expirée</Body>
        <div className="flex flex-wrap gap-3">
          <Button className={BUTTON} onClick={renew}>
            Demander à nouveau
          </Button>
        </div>
      </>
    );
  } else if (mandate) {
    content = (
      <>
        <p className="m-0 flex items-center gap-2 text-[15px] font-semibold">
          <ShieldCheck aria-hidden="true" className="size-5 shrink-0" />
          Autorisation active jusqu’à {formatTime(mandate.expiresAt)}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button className={BUTTON} disabled={flow.phase === 'revoking'} onClick={resume}>
            Reprendre ma demande
          </Button>
          <Button variant="secondary" className={BUTTON} disabled={flow.phase === 'revoking'} onClick={retract}>
            Retirer l’autorisation
          </Button>
        </div>
      </>
    );
  } else if (flow.phase === 'refused') {
    content = (
      <>
        <Body>Autorisation refusée. L’assistant ne fera aucune démarche à votre place.</Body>
        <div className="flex flex-wrap gap-3">
          <Button variant="ghost" className={BUTTON} onClick={renew}>
            Changer d’avis
          </Button>
        </div>
      </>
    );
  } else if (flow.phase === 'revoked') {
    content = (
      <>
        <Body>Autorisation retirée</Body>
        <div className="flex flex-wrap gap-3">
          <Button variant="ghost" className={BUTTON} onClick={renew}>
            Demander à nouveau
          </Button>
        </div>
      </>
    );
  } else if (flow.phase === 'invalid') {
    content = (
      <>
        <Body>Cette autorisation n’est plus valable.</Body>
        <div className="flex flex-wrap gap-3">
          <Button className={BUTTON} onClick={renew}>
            Demander à nouveau
          </Button>
        </div>
      </>
    );
  } else if (flow.phase === 'error') {
    content = (
      <>
        <InlineAlert>{flow.message}</InlineAlert>
        <div className="flex flex-wrap gap-3">
          <Button className={BUTTON} onClick={retry}>
            Réessayer
          </Button>
        </div>
      </>
    );
  }

  return (
    <Tile
      tone="outline"
      role="region"
      aria-label="Autorisation demandée"
      className="ui-enter flex flex-col gap-4 rounded-[28px] p-7 md:p-7"
    >
      <h2 className="m-0 font-display text-[20px] font-extrabold tracking-[-0.02em]">Autorisation demandée</h2>
      {content}
    </Tile>
  );
}
