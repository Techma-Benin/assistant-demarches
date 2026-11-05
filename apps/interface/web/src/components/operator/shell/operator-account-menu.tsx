'use client';

import { THEME_STORAGE_KEY, cn } from '@techma/ui';
import { ChevronUp, LogOut, Monitor, Moon, Sun, User } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

type ThemePreference = 'system' | 'light' | 'dark';
const THEME_ORDER: ThemePreference[] = ['system', 'light', 'dark'];
const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'Thème : système',
  light: 'Thème : clair',
  dark: 'Thème : sombre',
};
const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/** Signed-in label for this console. The operator account has no personal name here. */
const IDENTITY = 'Opérateur';

type Anchor = { left: number; bottom: number };

function readTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function readAnchor(element: HTMLElement): Anchor {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, bottom: window.innerHeight - rect.top + 8 };
}

function OperatorMark() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-trust text-on-trust"
    >
      <User className="size-4" strokeWidth={2} />
    </span>
  );
}

/**
 * Account control pinned to the operator sidebar foot, in the same pattern as the
 * administration console: the trigger opens a menu upward for theme and sign-out.
 */
export function OperatorAccountMenu({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [mounted, setMounted] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nameId = useId();
  const menuId = useId();

  useEffect(() => setMounted(true), []);
  useEffect(() => setTheme(readTheme()), []);

  function closeAll(focusTrigger = false) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (triggerRef.current) setAnchor(readAnchor(triggerRef.current));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, collapsed]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (layerRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeAll(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || !anchor) return;
    const menu = menuRef.current;
    if (!menu || menu.contains(document.activeElement)) return;
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open, anchor]);

  function cycleTheme() {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
    setTheme(next);
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice only lasts for this page.
    }
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      closeAll(true);
    } else if (event.key === 'Tab') closeAll(false);
  }

  const ThemeIcon = THEME_ICONS[theme];

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      aria-labelledby={nameId}
      onClick={() => {
        if (open) closeAll(false);
        else setOpen(true);
      }}
      onKeyDown={(event) => {
        if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !open) {
          event.preventDefault();
          setOpen(true);
        }
      }}
      className={cn(
        'ui-press flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-[background-color,transform] duration-(--ui-dur-press) ease-(--ui-ease-out) hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
        collapsed && 'md:justify-center md:px-0',
      )}
    >
      <OperatorMark />
      <span id={nameId} className={cn('min-w-0 flex-1 truncate text-[13px] leading-tight font-semibold text-ink', collapsed && 'md:sr-only')}>
        {IDENTITY}
      </span>
      <ChevronUp aria-hidden="true" className={cn('size-4 shrink-0 text-ink-subtle', collapsed && 'md:hidden')} />
    </button>
  );

  const layer =
    open && anchor && mounted
      ? createPortal(
          <div ref={layerRef} className="fixed z-50" style={{ left: Math.max(8, anchor.left), bottom: anchor.bottom }}>
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label="Compte"
              onKeyDown={onMenuKeyDown}
              style={{ transformOrigin: 'bottom left' }}
              className="ui-pop w-[260px] rounded-xl border border-line-subtle bg-surface p-1.5 shadow-(--ui-shadow-pop)"
            >
              <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
                <OperatorMark />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] leading-tight font-medium text-ink-subtle">Compte</span>
                  <span className="block truncate text-[13px] leading-tight font-semibold text-ink">{IDENTITY}</span>
                </span>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={cycleTheme}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] font-semibold text-ink hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-2 focus-visible:outline-ink"
              >
                <ThemeIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
                {THEME_LABELS[theme]}
              </button>
              <div className="my-1 h-px bg-line-subtle" />
              <form method="post" action="/auth/logout">
                <button
                  type="submit"
                  role="menuitem"
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] font-semibold text-danger hover:bg-danger-soft focus-visible:bg-danger-soft focus-visible:outline-2 focus-visible:outline-ink"
                >
                  <LogOut aria-hidden="true" className="size-4 shrink-0" />
                  Se déconnecter
                </button>
              </form>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {trigger}
      {layer}
    </>
  );
}
