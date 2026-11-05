'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@techma/ui';
import { CircleUser } from 'lucide-react';
import { useSessionUser } from '@/hooks/use-session-user';
import { clearConversation } from '@/lib/conversation-persistence';

/** Signed-in citizens only: name, link to « Mes démarches » and sign out (disclosure panel, not a menu). */
export function AccountMenu() {
  const { status, name } = useSessionUser();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  if (status !== 'user') return null;
  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Mon compte"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="ui-press inline-flex size-11 items-center justify-center rounded-pill text-ink transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <CircleUser aria-hidden="true" className="size-6" strokeWidth={1.8} />
      </button>
      {open && (
        <div
          id={panelId}
          className="surface-glass absolute right-0 top-full z-40 mt-2 flex w-[min(280px,calc(100vw-2rem))] flex-col gap-3 rounded-card p-4 shadow-(--ui-shadow-pop)"
        >
          {name && <p className="m-0 break-words text-[14px] text-ink-muted">{name}</p>}
          <Link
            href="/demarches"
            className="inline-flex min-h-11 items-center text-[16px] font-semibold text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Mes démarches
          </Link>
          {/* The next person on a shared computer must not land in this conversation. */}
          <form method="post" action="/auth/logout" onSubmit={() => clearConversation()}>
            <Button type="submit" variant="outline" className="w-full">
              Se déconnecter
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
