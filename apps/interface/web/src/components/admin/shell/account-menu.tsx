'use client';

import { THEME_STORAGE_KEY, cn } from '@techma/ui';
import { Check, ChevronRight, ChevronUp, LogOut, Monitor, Moon, Search, Sun } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { badgeTone } from '@/lib/admin/badge-tone';
import { isConnected, useConsole } from '../console/console-context';

type ThemePreference = 'system' | 'light' | 'dark';
const THEME_ORDER: ThemePreference[] = ['system', 'light', 'dark'];
const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'Thème : système',
  light: 'Thème : clair',
  dark: 'Thème : sombre',
};
const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

type Anchor = { left: number; bottom: number };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

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

function Avatar({ name, toneKey, className }: { name: string; toneKey?: string | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tracking-wide',
        className,
        toneKey ? badgeTone(toneKey) : 'bg-trust text-on-trust',
      )}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Account control pinned to the sidebar foot, in the Composio pattern:
 * the trigger opens a menu upward; « Administration » opens a second panel to switch.
 */
export function AccountMenu({ collapsed }: { collapsed: boolean }) {
  const { profile, administrations, administration, administrationId, isSuperAdmin, selectAdministration, loading } = useConsole();
  const displayName = profile?.official.displayName ?? (loading ? 'Chargement…' : 'Compte');
  const administrationName = administration?.name ?? (loading ? 'Chargement…' : 'Aucune administration');
  const administrationToneKey = administration?.id ?? administrationId;
  const canSwitch = isSuperAdmin && administrations.length > 0;

  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [mounted, setMounted] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const accountMenuId = useId();
  const pickerMenuId = useId();

  useEffect(() => setMounted(true), []);
  useEffect(() => setTheme(readTheme()), []);

  function closeAll(focusTrigger = false) {
    setOpen(false);
    setPicker(false);
    setQuery('');
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
    if (!open) return;
    const items = accountMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items?.[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!picker) return;
    searchRef.current?.focus();
  }, [picker]);

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

  function onAccountKeyDown(event: KeyboardEvent) {
    const items = Array.from(accountMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
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

  function onPickerKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setPicker(false);
      setQuery('');
      accountMenuRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
      return;
    }
    const radios = Array.from(pickerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (radios.length === 0) return;
      const index = radios.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Home') radios[0]?.focus();
      else if (event.key === 'End') radios[radios.length - 1]?.focus();
      else if (event.key === 'ArrowDown') radios[index < 0 ? 0 : (index + 1) % radios.length]?.focus();
      else radios[index <= 0 ? radios.length - 1 : index - 1]?.focus();
    }
  }

  const filtered = administrations.filter((candidate) =>
    candidate.name.toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr')),
  );
  const ThemeIcon = THEME_ICONS[theme];

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? accountMenuId : undefined}
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
      <Avatar name={displayName} toneKey={administrationToneKey ?? profile?.official.id} />
      <span className={cn('min-w-0 flex-1', collapsed && 'md:sr-only')}>
        <span id={nameId} className="block truncate text-[13px] leading-tight font-semibold text-ink">
          {displayName}
        </span>
        <span className="block truncate text-[12px] leading-tight text-ink-subtle" aria-label={`Administration : ${administrationName}`}>
          {administrationName}
        </span>
      </span>
      <ChevronUp aria-hidden="true" className={cn('size-4 shrink-0 text-ink-subtle', collapsed && 'md:hidden')} />
    </button>
  );

  const layer =
    open && anchor && mounted
      ? createPortal(
          <div
            ref={layerRef}
            className="fixed z-50 flex flex-col-reverse items-start gap-2 md:flex-row md:items-end"
            style={{ left: Math.max(8, anchor.left), bottom: anchor.bottom }}
          >
            <div
              ref={accountMenuRef}
              id={accountMenuId}
              role="menu"
              aria-label="Compte"
              onKeyDown={onAccountKeyDown}
              style={{ transformOrigin: 'bottom left' }}
              className="ui-pop w-[260px] rounded-xl border border-line-subtle bg-surface p-1.5 shadow-(--ui-shadow-pop)"
            >
              {canSwitch ? (
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={picker}
                  aria-controls={picker ? pickerMenuId : undefined}
                  onClick={() => setPicker((value) => !value)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-2 focus-visible:outline-ink"
                >
                  <Avatar name={administrationName} toneKey={administrationToneKey} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] leading-tight font-medium text-ink-subtle">Administration</span>
                    <span className="block truncate text-[13px] leading-tight font-semibold text-ink">{administrationName}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
                </button>
              ) : (
                <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
                  <Avatar name={administrationName} toneKey={administrationToneKey} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] leading-tight font-medium text-ink-subtle">Administration</span>
                    <span className="block truncate text-[13px] leading-tight font-semibold text-ink">{administrationName}</span>
                  </span>
                </div>
              )}
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

            {picker && canSwitch ? (
              <div
                ref={pickerRef}
                id={pickerMenuId}
                role="menu"
                aria-label="Changer d’administration"
                onKeyDown={onPickerKeyDown}
                style={{ transformOrigin: 'bottom left' }}
                className="ui-pop flex w-[280px] flex-col rounded-xl border border-line-subtle bg-surface p-1.5 shadow-(--ui-shadow-pop)"
              >
                <label className="mb-1 flex items-center gap-2 rounded-lg border border-line-subtle px-2.5 py-2">
                  <Search aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
                  <span className="sr-only">Rechercher une administration</span>
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Rechercher…"
                    className="w-full bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-ink-subtle"
                  />
                </label>
                <div className="max-h-64 overflow-y-auto">
                  {filtered.length === 0 ? (
                    <p className="px-2.5 py-3 text-[13px] font-medium text-ink-subtle">Aucune administration</p>
                  ) : (
                    filtered.map((candidate) => {
                      const checked = candidate.id === administrationId;
                      const selectable = isConnected(candidate);
                      return (
                        <button
                          key={candidate.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={checked}
                          disabled={!selectable}
                          onClick={() => {
                            closeAll(true);
                            if (!checked && selectable) void selectAdministration(candidate.id);
                          }}
                          className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Avatar name={candidate.name} toneKey={candidate.id} className="size-7 text-[10px]" />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{candidate.name}</span>
                          <Check aria-hidden="true" className={cn('size-4 shrink-0 text-ink', !checked && 'invisible')} strokeWidth={2.4} />
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}
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
