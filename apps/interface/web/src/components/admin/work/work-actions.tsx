'use client';

import { Button, Dialog, DialogBody, DialogContent, DialogFooter, InlineAlert, TextArea } from '@techma/ui';
import { Check, CircleX, MessageSquarePlus, UserPlus } from 'lucide-react';
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

const ACTION_BUTTONS: Array<{
  action: CaseAction;
  label: string;
  variant: 'primary' | 'secondary' | 'trust' | 'outline';
  icon: typeof UserPlus;
}> = [
  { action: 'claim', label: 'Prendre en charge', variant: 'primary', icon: UserPlus },
  { action: 'request_information', label: 'Demander un complément', variant: 'secondary', icon: MessageSquarePlus },
  { action: 'approve', label: 'Approuver', variant: 'trust', icon: Check },
  { action: 'reject', label: 'Rejeter', variant: 'outline', icon: CircleX },
];

const DECIDE_ACTIONS: ReadonlySet<CaseAction> = new Set(['request_information', 'approve', 'reject']);

/** Decide actions stay hidden until this official has claimed the dossier. */
export function toolbarActions(item: Pick<Case, 'status' | 'claimedBy'>, officialId: string | null | undefined): CaseAction[] {
  const actions = allowedActions(item);
  if (item.claimedBy && officialId && item.claimedBy === officialId) return actions;
  return actions.filter((action) => !DECIDE_ACTIONS.has(action));
}

export function useWorkActions({
  item,
  enabled,
  officialId,
  onUpdated,
  onConflict,
}: {
  item: Case | null;
  enabled: boolean;
  officialId: string | null | undefined;
  onUpdated: (item: Case, message: string) => void;
  onConflict: () => void;
}) {
  const actions = item && enabled ? toolbarActions(item, officialId) : [];
  const [pending, setPending] = useState<CaseAction | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intent = useRef<{ signature: string; key: string } | null>(null);

  async function send(action: CaseAction, text: string | null) {
    if (!item) return;
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

  return {
    actions,
    pending,
    note,
    setNote,
    sending,
    error,
    start,
    send,
    cancel: () => {
      setPending(null);
      setNote('');
      setError(null);
    },
    noteCopy: pending ? NOTE_COPY[pending] : undefined,
  };
}

export function WorkActionToolbar({
  actions,
  sending,
  onStart,
}: {
  actions: CaseAction[];
  sending: boolean;
  onStart: (action: CaseAction) => void;
}) {
  if (actions.length === 0) return null;
  return (
    <section aria-label="Actions" className="flex flex-wrap items-center justify-end gap-2">
      {ACTION_BUTTONS.filter((button) => actions.includes(button.action)).map((button) => (
        <Button
          key={button.action}
          size="sm"
          variant={button.variant}
          disabled={sending}
          leadingIcon={<button.icon aria-hidden="true" className="size-4" />}
          onClick={() => onStart(button.action)}
        >
          {button.label}
        </Button>
      ))}
    </section>
  );
}

export function WorkActionNote({
  pending,
  note,
  setNote,
  sending,
  error,
  noteCopy,
  onSend,
  onCancel,
}: {
  pending: CaseAction | null;
  note: string;
  setNote: (value: string) => void;
  sending: boolean;
  error: string | null;
  noteCopy?: { label: string; hint: string; confirm: string };
  onSend: (action: CaseAction, text: string | null) => void;
  onCancel: () => void;
}) {
  const open = Boolean(pending && noteCopy);
  return (
    <>
      {!open && error ? <InlineAlert>{error}</InlineAlert> : null}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !sending) onCancel();
        }}
      >
        {pending && noteCopy ? (
          <DialogContent
            title={noteCopy.label}
            description={noteCopy.hint}
            onEscapeKeyDown={(event) => {
              if (sending) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (sending) event.preventDefault();
            }}
          >
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                if (note.trim()) onSend(pending, note.trim());
              }}
            >
              <DialogBody>
                <TextArea
                  label={noteCopy.label}
                  hint={noteCopy.hint}
                  required
                  maxLength={MAX_NOTE}
                  value={note}
                  disabled={sending}
                  onChange={(event) => setNote(event.target.value)}
                />
                {error ? <InlineAlert className="mt-3">{error}</InlineAlert> : null}
              </DialogBody>
              <DialogFooter>
                <Button type="submit" disabled={sending || note.trim() === ''}>
                  {noteCopy.confirm}
                </Button>
                <Button type="button" variant="ghost" disabled={sending} onClick={onCancel}>
                  Annuler
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
