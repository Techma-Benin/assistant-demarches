'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@techma/ui';
import { X } from 'lucide-react';

const CLOSE_MS = 150;

/** Native modal `<dialog>` holding the dossier panels: bottom sheet on phones, right drawer from md. Content only exists while open. */
export function DossierSheet({
  open,
  onClose,
  side = 'bottom',
  label = 'Votre demande',
  children,
}: {
  open: boolean;
  onClose: () => void;
  side?: 'bottom' | 'right';
  label?: string;
  children: ReactNode;
}) {
  const drawer = side === 'right';
  const ref = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setClosing(false);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
  }, [open]);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => {
      const dialog = ref.current;
      if (dialog?.open && typeof dialog.close === 'function') dialog.close();
      else onClose();
    }, CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      data-closing={closing || undefined}
      onCancel={(event) => {
        event.preventDefault();
        setClosing(true);
      }}
      onClose={() => {
        setClosing(false);
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) setClosing(true);
      }}
      className={
        drawer
          ? 'chat-drawer fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-[360px] max-w-full overflow-y-auto border-l border-line bg-canvas p-0 text-ink min-[1440px]:hidden'
          : 'chat-sheet fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-card border border-b-0 border-line bg-canvas p-0 text-ink'
      }
    >
      {open && (
        <div className={cn('flex flex-col gap-4 p-4', !drawer && 'pb-[max(1rem,env(safe-area-inset-bottom))]')}>
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => setClosing(true)}
            className="ui-press -mb-2 flex size-11 items-center justify-center self-end rounded-pill text-ink hover:bg-sunken"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
          {children}
        </div>
      )}
    </dialog>
  );
}
