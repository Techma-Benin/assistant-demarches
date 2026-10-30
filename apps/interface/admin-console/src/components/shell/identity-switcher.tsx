'use client';

import { cn } from '@techma/ui';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { accessLabel, type Identity } from '@/lib/permissions';
import { useSession } from '../session/session-context';

/** Initials of the identity label, skipping short words: « Mairie de Cotonou » → « MC ». */
function initials(label: string): string {
  const words = label.split(/\s+/).filter((word) => word.length > 2);
  return (words.length ? words : [label]).slice(0, 2).map((word) => word[0].toUpperCase()).join('');
}

/** Square badge whose colour tells the kind of access at a glance (ink: platform, green: write, yellow: read). */
function IdentityAvatar({ identity, size = 'md' }: { identity: Identity; size?: 'sm' | 'md' }) {
  const tone =
    identity.kind === 'platform'
      ? 'bg-action text-on-action'
      : identity.access === 'write'
        ? 'bg-trust text-on-trust'
        : 'bg-sun text-warning';
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[10px] font-display font-extrabold tracking-[-0.02em]',
        size === 'md' ? 'size-9 text-[13px]' : 'size-8 text-xs',
        tone,
      )}
    >
      {initials(identity.label)}
    </span>
  );
}

/** Who the person is acting as: active identity, and a menu to switch when the session has several. */
export function IdentitySwitcher() {
  const { session, identity, switchIdentity, switching } = useSession();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);

  // Focus the checked item when the menu opens.
  useEffect(() => {
    if (!open) return;
    const all = items();
    (all.find((item) => item.getAttribute('aria-checked') === 'true') ?? all[0])?.focus();
  }, [open]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (!session || !identity) return null;

  const content = (
    <>
      <IdentityAvatar identity={identity} />
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-sm leading-tight font-bold">{identity.label}</span>
        <span className="truncate text-xs leading-tight text-ink-muted">{accessLabel(identity)}</span>
      </span>
    </>
  );
  const frame = 'flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line-subtle bg-surface p-2.5 pr-3';

  if (session.identities.length < 2) return <div className={frame}>{content}</div>;

  const close = (focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = (next: number) => {
      event.preventDefault();
      all[(next + all.length) % all.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(all.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') close(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={switching}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(frame, 'ui-press cursor-pointer hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-60')}
      >
        {content}
        <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Changer d’identité"
          onKeyDown={onMenuKeyDown}
          // Wider than the sidebar on desktop so names never wrap mid-word; full width in the mobile menu.
          className="ui-pop absolute top-full left-0 z-40 mt-2 flex w-full flex-col rounded-2xl border border-line bg-surface p-1.5 shadow-(--ui-shadow-pop) md:w-[328px]"
        >
          <div aria-hidden="true" className="flex flex-col px-2.5 pt-1.5 pb-2">
            <span className="text-sm leading-tight font-semibold">{session.displayName}</span>
            <span className="text-xs leading-tight text-ink-muted">Agir en tant que</span>
          </div>
          {session.identities.map((candidate) => {
            const checked = candidate.id === identity.id;
            return (
              <button
                key={candidate.id}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                disabled={switching}
                onClick={() => {
                  close(true);
                  if (!checked) void switchIdentity(candidate.id);
                }}
                className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-60"
              >
                <IdentityAvatar identity={candidate} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm leading-tight font-semibold">{candidate.label}</span>
                  <span className="text-xs leading-tight text-ink-muted">{accessLabel(candidate)}</span>
                </span>
                <Check aria-hidden="true" className={cn('size-4 shrink-0', !checked && 'invisible')} strokeWidth={2.6} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
