'use client';

import { cn } from '@techma/ui';
import { Check } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface MenuOption {
  id: string;
  /** Rendered in the menu row (badge + texts). */
  content: ReactNode;
}

/**
 * Button + radio menu used by the session switcher and the ministry selector:
 * arrow keys, Home/End, Escape (refocuses the trigger), click outside closes.
 */
export function MenuSelect({
  menuLabel,
  header,
  trigger,
  options,
  checkedId,
  onSelect,
  disabled,
  triggerClassName,
}: {
  menuLabel: string;
  header?: ReactNode;
  trigger: ReactNode;
  options: MenuOption[];
  checkedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
  triggerClassName: string;
}) {
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
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          triggerClassName,
          'ui-press cursor-pointer hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          onKeyDown={onMenuKeyDown}
          // Wider than the sidebar on desktop so names never wrap mid-word; full width in the mobile menu.
          className="ui-pop absolute top-full left-0 z-40 mt-2 flex w-full flex-col rounded-2xl border border-line bg-surface p-1.5 shadow-(--ui-shadow-pop) md:w-[328px]"
        >
          {header}
          {options.map((option) => {
            const checked = option.id === checkedId;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                disabled={disabled}
                onClick={() => {
                  close(true);
                  if (!checked) onSelect(option.id);
                }}
                className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-60"
              >
                {option.content}
                <Check aria-hidden="true" className={cn('size-4 shrink-0', !checked && 'invisible')} strokeWidth={2.6} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
