'use client';

import { useEffect, useId, useRef } from 'react';
import { Button } from '@techma/ui';

/** Confirmation before throwing away a conversation that holds a dossier. Native modal: focus trap and Esc come free. */
export function RestartDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="chat-dialog m-auto w-[min(92vw,26rem)] rounded-card border border-line bg-surface p-7 text-ink shadow-prompt"
    >
      <h2 id={titleId} className="m-0 font-display text-[22px] font-extrabold tracking-[-0.03em]">
        Recommencer une conversation ?
      </h2>
      <p className="mb-6 mt-3 text-[16px] leading-[1.5] text-ink-muted">Vous perdrez l’affichage de cette conversation.</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button onClick={onConfirm}>Recommencer</Button>
      </div>
    </dialog>
  );
}
