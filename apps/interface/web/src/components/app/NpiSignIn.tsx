'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, InlineAlert, TextField } from '@techma/ui';
import { navigate } from '@/lib/navigate';

type Props = {
  conversationId?: string | null;
  returnTo: string;
  /** Signed in with the conversation attached: stay on the page instead of navigating to `returnTo`. */
  onSignedIn?: () => void;
};
type Step = 'npi' | 'code';

/** Safety net: a session read that never reports the account would leave the form frozen. */
const SESSION_READ_TIMEOUT_MS = 4000;
const DIGITS = /^[0-9]+$/;
const MAX_LENGTH: Record<Step, number> = { npi: 20, code: 12 };

const MESSAGES = {
  digits: 'Saisissez uniquement des chiffres.',
  empty: 'Ce champ est obligatoire.',
  rejected: 'Ces chiffres ne sont pas acceptés. Vérifiez votre saisie.',
  expired: 'Votre demande a expiré. Saisissez de nouveau votre NPI.',
  tooMany: 'Trop de tentatives. Patientez quelques instants avant de réessayer.',
  unavailable: 'La connexion est indisponible pour le moment. Réessayez dans un instant.',
} as const;

function errorFor(status: number, step: Step): { message: string; backToStart: boolean } {
  if (status === 400) return { message: MESSAGES.rejected, backToStart: false };
  if (status === 401) return { message: step === 'code' ? MESSAGES.expired : MESSAGES.rejected, backToStart: step === 'code' };
  if (status === 429) return { message: MESSAGES.tooMany, backToStart: false };
  return { message: MESSAGES.unavailable, backToStart: false };
}

/** `returnTo` with `attach=failed` when the guest's conversation could not be moved to the account (as the OIDC callback does). */
function withAttachFailure(returnTo: string): string {
  const url = new URL(returnTo, window.location.origin);
  url.searchParams.set('attach', 'failed');
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Simulated NPI sign-in, in two steps. Nothing typed here goes through the conversation or browser storage. */
export function NpiSignIn({ conversationId, returnTo, onSignedIn }: Props) {
  const baseId = useId();
  const [step, setStep] = useState<Step>('npi');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (fallback.current !== null) clearTimeout(fallback.current);
    },
    [],
  );

  // Focus the field of the current step (also after an error brings the user back).
  const fieldId = `${baseId}-${step}`;
  const focusField = () => document.getElementById(fieldId)?.focus();
  useEffect(() => {
    document.getElementById(fieldId)?.focus();
  }, [fieldId]);

  function restart(message: string | null) {
    setValue('');
    setStep('npi');
    setError(message);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const typed = value.trim();
    if (!typed) return fail(MESSAGES.empty);
    if (!DIGITS.test(typed) || typed.length > MAX_LENGTH[step]) return fail(MESSAGES.digits);

    setError(null);
    setPending(true);
    let stay = false;
    try {
      const response = await fetch(step === 'npi' ? '/auth/npi' : '/auth/npi/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(step === 'npi' ? { npi: typed } : { code: typed, ...(conversationId ? { conversationId } : {}) }),
      });
      if (!response.ok) {
        const { message, backToStart } = errorFor(response.status, step);
        if (backToStart) restart(message);
        else {
          setValue('');
          setError(message);
          focusField();
        }
        return;
      }
      if (step === 'npi') {
        // The NPI is gone from the state as soon as the Backend has it.
        setValue('');
        setStep('code');
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { attachFailed?: unknown };
      if (body.attachFailed !== true && onSignedIn) {
        // Stays pending until the form unmounts (the session read turns the block into "Connexion effectuée.").
        stay = true;
        onSignedIn();
        fallback.current = setTimeout(() => navigate(returnTo), SESSION_READ_TIMEOUT_MS);
        return;
      }
      navigate(body.attachFailed === true ? withAttachFailure(returnTo) : returnTo);
    } catch {
      setError(MESSAGES.unavailable);
    } finally {
      if (!stay) setPending(false);
    }
  }

  function fail(message: string) {
    setError(message);
    focusField();
  }

  const isNpi = step === 'npi';
  const errorId = `${baseId}-error`;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5" aria-busy={pending}>
      <TextField
        key={step}
        id={fieldId}
        name={isNpi ? 'npi' : 'code'}
        label={isNpi ? 'Votre NPI' : 'Code reçu par SMS'}
        type="text"
        inputMode="numeric"
        autoComplete={isNpi ? 'off' : 'one-time-code'}
        maxLength={MAX_LENGTH[step] + 8}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        readOnly={pending}
        aria-describedby={error ? errorId : undefined}
        className="h-14 rounded-2xl px-[18px] text-[17px]"
      />
      {error && <InlineAlert id={errorId}>{error}</InlineAlert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending} className="min-h-[52px] px-7 font-bold">
          {isNpi ? 'Continuer' : 'Valider'}
        </Button>
        {!isNpi && (
          <Button type="button" variant="secondary" size="lg" disabled={pending} onClick={() => restart(null)} className="min-h-[52px] px-7 font-bold">
            Changer de NPI
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-1 text-[14px] text-ink-muted">
        <p className="m-0">Simulation : aucun SMS n’est envoyé. Saisissez les chiffres de votre choix.</p>
        <p className="m-0">Cette saisie reste hors de la conversation : l’assistant ne la voit pas.</p>
      </div>
    </form>
  );
}
