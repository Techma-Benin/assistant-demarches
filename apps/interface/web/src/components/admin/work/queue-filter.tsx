'use client';

import { cn } from '@techma/ui';
import { Filter, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Case, CaseStatus } from '@/lib/admin/api';
import {
  CHANNEL_LABELS,
  EMPTY_CASE_FILTERS,
  STATUS_LABELS,
  type CaseListFilters,
} from '@/lib/admin/work-format';

const CHANNELS = ['web', 'whatsapp'] as const satisfies readonly Case['channel'][];

function toggleValue<T extends string>(current: readonly T[], value: T): T[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]';

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => !node.hasAttribute('disabled'));
}

/** Filter icon immediately to the right of search. Opens the gray glass panel. */
export function QueueFilter({
  statuses,
  filters,
  onChange,
}: {
  statuses: readonly CaseStatus[];
  filters: CaseListFilters;
  onChange: (next: CaseListFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  const active =
    filters.channels.length > 0 || filters.statuses.length > 0 || filters.updatedFrom !== '' || filters.updatedTo !== '';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Filtrer les dossiers"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'relative inline-flex size-9 shrink-0 items-center justify-center rounded-pill transition-colors duration-(--ui-dur-press) ease-(--ui-ease-out) hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
          active ? 'text-ink' : 'text-ink-muted hover:text-ink',
        )}
      >
        <Filter aria-hidden="true" className="size-4" />
        {active ? <span aria-hidden="true" className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-ink" /> : null}
      </button>
      {open
        ? createPortal(
            <FilterPanel
              id={panelId}
              statuses={statuses}
              filters={filters}
              onChange={onChange}
              onClose={close}
              returnFocus={buttonRef}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function FilterPanel({
  id,
  statuses,
  filters,
  onChange,
  onClose,
  returnFocus,
}: {
  id: string;
  statuses: readonly CaseStatus[];
  filters: CaseListFilters;
  onChange: (next: CaseListFilters) => void;
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const root = panelRef.current;
    root?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !root) return;
      const items = focusable(root);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === root || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      returnFocus.current?.focus();
    };
  }, [onClose, returnFocus]);

  function patch(partial: Partial<CaseListFilters>) {
    onChange({ ...filters, ...partial });
  }

  const rangeInverted = filters.updatedFrom !== '' && filters.updatedTo !== '' && filters.updatedFrom > filters.updatedTo;

  return (
    <div className="fixed inset-0 z-50 flex justify-end p-3 sm:p-4">
      <div data-filter-backdrop="" className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-glass="liquid"
        data-tint="gray"
        className="queue-filter-glass flex h-full max-h-full w-[min(22.5rem,100%)] flex-col rounded-card focus:outline-none"
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-2">
          <h2 id={titleId} className="font-display text-2xl font-extrabold tracking-[-0.035em]">
            Filtres
          </h2>
          <button
            type="button"
            aria-label="Fermer"
            onClick={onClose}
            className="inline-flex size-9 items-center justify-center rounded-pill text-ink-muted hover:bg-black/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 pt-3 pb-5">
          <ToggleGroup
            legend="Canal"
            values={filters.channels}
            onToggle={(channel) => patch({ channels: toggleValue(filters.channels, channel) })}
            options={CHANNELS.map((channel) => ({ value: channel, label: CHANNEL_LABELS[channel] }))}
          />
          <ToggleGroup
            legend="Type de statut"
            values={filters.statuses}
            onToggle={(status) => patch({ statuses: toggleValue(filters.statuses, status) })}
            options={statuses.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
          />
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 text-[13px] font-semibold text-ink">Date de mise à jour</legend>
            <div className="flex gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] font-medium text-ink">
                Du
                <input
                  type="date"
                  value={filters.updatedFrom}
                  onChange={(event) => patch({ updatedFrom: event.target.value })}
                  className="h-10 w-full rounded-field border border-line bg-white/55 px-3 text-[13px] font-medium text-ink"
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] font-medium text-ink">
                Au
                <input
                  type="date"
                  value={filters.updatedTo}
                  onChange={(event) => patch({ updatedTo: event.target.value })}
                  className="h-10 w-full rounded-field border border-line bg-white/55 px-3 text-[13px] font-medium text-ink"
                />
              </label>
            </div>
            {rangeInverted ? (
              <p className="text-[13px] text-ink">La date de début est après la date de fin.</p>
            ) : null}
          </fieldset>
          <button
            type="button"
            onClick={() => onChange(EMPTY_CASE_FILTERS)}
            className="mt-auto self-start rounded-pill px-3 py-2 text-[13px] font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Réinitialiser
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleGroup<T extends string>({
  legend,
  values,
  options,
  onToggle,
}: {
  legend: string;
  values: readonly T[];
  options: readonly { value: T; label: string }[];
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-[13px] font-semibold text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = values.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onToggle(option.value)}
              className={cn(
                'inline-flex min-h-9 items-center rounded-pill border px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
                selected
                  ? 'border-action bg-action font-semibold text-on-action shadow-[0_6px_16px_rgb(0_0_0/0.22)]'
                  : 'border-line bg-white/25 font-medium text-ink-muted hover:bg-white/50 hover:text-ink',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
