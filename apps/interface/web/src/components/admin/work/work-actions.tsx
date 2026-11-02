'use client';

import { Button, InlineAlert, TextArea } from '@techma/ui';
import { useRef, useState } from 'react';
import { departmentApi, type AdminWorkItem, type WorkAction } from '@/lib/admin/department-api';
import { toActionFailure } from '@/lib/admin/work-errors';
import { ACTION_SUCCESS, allowedActions } from '@/lib/admin/work-format';

const needsReason: Partial<Record<WorkAction, { label: string; confirm: string }>> = {
  request_information: { label: 'Information demandée à l’usager', confirm: 'Envoyer la demande' },
  reject: { label: 'Motif du rejet', confirm: 'Confirmer le rejet' },
};

/** Agent actions allowed by the item status. Disabled while a request is in flight. */
export function WorkActions({
  item,
  onUpdated,
  onConflict,
}: {
  item: AdminWorkItem;
  onUpdated: (item: AdminWorkItem, message: string) => void;
  /** 409: the item changed meanwhile, the parent reloads it. */
  onConflict: () => void;
}) {
  const actions = allowedActions(item.status);
  const [pending, setPending] = useState<WorkAction | null>(null); // action awaiting a reason
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per intent: kept after a retryable failure so the retry is idempotent.
  const intent = useRef<{ signature: string; key: string } | null>(null);

  if (actions.length === 0) return null;

  async function send(action: WorkAction, text?: string) {
    const signature = `${item.id}:${item.revision}:${action}:${text ?? ''}`;
    if (intent.current?.signature !== signature) {
      intent.current = { signature, key: `act-${item.id}-${crypto.randomUUID()}` };
    }
    setSending(true);
    setError(null);
    try {
      const command = text !== undefined
        ? { action, revision: item.revision, reason: text }
        : { action, revision: item.revision };
      const updated = await departmentApi.act(item.id, command, intent.current.key);
      intent.current = null;
      setPending(null);
      setReason('');
      onUpdated(updated, ACTION_SUCCESS[action]);
    } catch (caught) {
      const failure = toActionFailure(caught);
      if (!failure.retryable) intent.current = null;
      setError(failure.message);
      if (failure.conflict) {
        setPending(null);
        setReason('');
        onConflict();
      }
    } finally {
      setSending(false);
    }
  }

  const start = (action: WorkAction) => {
    setError(null);
    if (needsReason[action]) {
      setPending(action);
      setReason('');
    } else {
      void send(action);
    }
  };

  const reasonCopy = pending ? needsReason[pending] : undefined;

  return (
    <section aria-label="Actions" className="flex flex-col gap-4">
      <h2 className="font-display text-2xl font-extrabold tracking-[-0.035em]">Actions</h2>
      <div className="flex flex-wrap gap-3">
        {actions.includes('claim') ? (
          <Button disabled={sending} onClick={() => start('claim')}>
            Prendre en charge
          </Button>
        ) : null}
        {actions.includes('resume') ? (
          <Button disabled={sending} onClick={() => start('resume')}>
            Reprendre
          </Button>
        ) : null}
        {actions.includes('request_information') ? (
          <Button variant="secondary" disabled={sending} onClick={() => start('request_information')}>
            Demander une information
          </Button>
        ) : null}
        {actions.includes('approve') ? (
          <Button variant="trust" disabled={sending} onClick={() => start('approve')}>
            Valider
          </Button>
        ) : null}
        {actions.includes('reject') ? (
          <Button variant="outline" disabled={sending} onClick={() => start('reject')}>
            Rejeter
          </Button>
        ) : null}
      </div>

      {pending && reasonCopy ? (
        <form
          className="flex max-w-xl flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim()) void send(pending, reason.trim());
          }}
        >
          <TextArea
            label={reasonCopy.label}
            required
            value={reason}
            disabled={sending}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex gap-3">
            <Button type="submit" disabled={sending || reason.trim() === ''}>
              {reasonCopy.confirm}
            </Button>
            <Button
              variant="ghost"
              disabled={sending}
              onClick={() => {
                setPending(null);
                setReason('');
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
