'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** Full-size image preview. Native modal: focus trap, Esc and focus return to the opener come free. */
export function ImagePreviewDialog({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }, []);

  // Closing through the dialog lets the browser hand focus back to the opener before React unmounts it.
  const close = () => {
    const dialog = ref.current;
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    else onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-label={`Aperçu de ${name}`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="image-preview m-0 h-dvh max-h-none w-screen max-w-none flex-col items-center justify-center gap-3 bg-black/85 p-4 backdrop:bg-transparent open:flex md:p-8"
    >
      <button
        type="button"
        aria-label="Fermer l’aperçu"
        onClick={close}
        className="ui-press absolute right-4 top-4 flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:right-8 md:top-8"
      >
        <X className="size-5" aria-hidden="true" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, nothing to optimise */}
      <img src={src} alt={name} className="image-preview-img max-h-[80dvh] max-w-full rounded-[12px] object-contain" />
      <p className="m-0 max-w-full truncate text-[15px] font-medium text-white">{name}</p>
    </dialog>
  );
}
