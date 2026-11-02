'use client';

import { Button, InlineAlert, TextArea } from '@techma/ui';
import { useRef, useState } from 'react';
import { adminApi, type Case, type CaseAction } from '@/lib/admin/api';
import { toFailure } from '@/lib/admin/errors';
import { ACTION_SUCCESS, NOTE_ACTIONS, allowedActions } from '@/lib/admin/work-format';

const NOTE_COPY: Partial<Record<CaseAction, { label: string; hint: string; confirm: string }>> = {
  request_information: {
    label: 'Complément demandé à l’usager',
    hint: 'Ce message est envoyé à l’usager.',
    confirm: 'Envoyer la demande',
  },
  reject: { label: 'Motif du rejet', hint: 'Ce motif est communiqué à l’usager.', confirm: 'Confirmer le rejet' },
};
const MAX_NOTE = 1000;

/** Agent actions allowed by the case status (§8). Disabled while a request is in flight. */
export function WorkActions({
  item,
  onUpdated,
  onConflict,
}: {
  item: Case;
  onUpdated: (item: Case, message: string) => void;
  /** 409: the case changed meanwhile, the parent reloads it. */
  onConflict: () => void;
}) {
  const actions = allowedActions(item.status);
  const [pending, setPending] = useState<CaseAction | null>(null); // action awaiting a note
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per intent: kept after a retryable failure so the retry is idempotent.
  const intent = useRef<{ signature: string; key: string } | null>(null);

  if (actions.length === 0) return null;

  async function send(action: CaseAction, text: string | null) {
    const signature = `${item.id}:${action}:${text ?? ''}`;
    if (intent.current?.signature !== signature) {
      intent.current = { signature, key: `act-${item.id}-${crypto.randomUUID()}` };
    }
    setSending(true);
    setError(null);
    try {
      const updated = await adminApi.act(item.id, { action, note: text }, intent.current.key);
      intent.current = null;
      setPending(null);
      setNote('');
      onUpdated(updated, ACTION_SUCCESS[action]);
    } catch (caught) {
      const failure = toFailure(caught);
      if (!failure.retryable) intent.current = null;
      setError(failure.message);
      if (failure.conflict) {
        setPending(null);
        setNote('');
        onConflict();
      }
    } finally {
      setSending(false);
    }
  }

  const start = (action: CaseAction) => {
    setError(null);
    if (NOTE_ACTIONS.includes(action)) {
      setPending(action);
      setNote('');
    } else {
      void send(action, null);
    }
  };

  const noteCopy = pending ? NOTE_COPY[pending] : undefined;

  return (
    <section aria-label="Actions" className="flex flex-col gap-4">
      <h2 className="font-display text-2xl font-extrabold tracking-[-0.035em]">Actions</h2>
      <div className="flex flex-wrap gap-3">
        {actions.includes('claim') ? (
          <Button disabled={sending} onClick={() => start('claim')}>
            Prendre en charge
          </Button>
        ) : null}
        {actions.includes('request_information') ? (
          <Button variant="secondary" disabled={sending} onClick={() => start('request_information')}>
            Demander un complément
          </Button>
        ) : null}
        {actions.includes('approve') ? (
          <Button variant="trust" disabled={sending} onClick={() => start('approve')}>
            Approuver
          </Button>
        ) : null}
        {actions.includes('reject') ? (
          <Button variant="outline" disabled={sending} onClick={() => start('reject')}>
            Rejeter
          </Button>
        ) : null}
      </div>

      {pending && noteCopy ? (
        <form
          className="flex max-w-xl flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (note.trim()) void send(pending, note.trim());
          }}
        >
          <TextArea
            label={noteCopy.label}
            hint={noteCopy.hint}
            required
            maxLength={MAX_NOTE}
            value={note}
            disabled={sending}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex gap-3">
            <Button type="submit" disabled={sending || note.trim() === ''}>
              {noteCopy.confirm}
            </Button>
            <Button
              variant="ghost"
              disabled={sending}
              onClick={() => {
                setPending(null);
                setNote('');
              }}
            >
              Annuler
            </Button>
          </div>
        </form>
      ) : null}

      {error ? <InlineAlert>{error}</InlineAlert> : null}
    </section>
  );
}
