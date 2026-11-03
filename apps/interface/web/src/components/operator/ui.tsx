'use client';

import { VisuallyHidden, cn } from '@techma/ui';
import { useCallback, useId, useState, type ReactNode, type SelectHTMLAttributes } from 'react';

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="font-display text-[clamp(30px,4vw,44px)] leading-[1] font-extrabold tracking-[-0.04em] break-words">
          {title}
        </h1>
        {description ? <p className="max-w-[640px] text-base text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}

/** Message for the `Toast`; `dismiss` is stable (the Toast timer depends on it). */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const dismiss = useCallback(() => setMessage(null), []);
  return { message, show: setMessage, dismiss };
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  options: readonly { value: string; label: string }[];
};

/** Native select with the same label/hint/error wiring as the kit's TextField. */
export function SelectField({ label, hint, error, required, options, className, id, ...props }: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const describedBy = [hint ? `${fieldId}-hint` : null, error ? `${fieldId}-error` : null].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-[15px] font-semibold text-ink">
        {label}
        {required ? (
          <>
            <span aria-hidden="true"> *</span>
            <VisuallyHidden> (obligatoire)</VisuallyHidden>
          </>
        ) : null}
      </label>
      {hint ? (
        <p id={`${fieldId}-hint`} className="text-[13px] text-ink-muted">
          {hint}
        </p>
      ) : null}
      <select
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          'min-h-11 w-full rounded-field border bg-surface px-3 text-base text-ink',
          error ? 'border-danger' : 'border-field',
          className,
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={`${fieldId}-error`} className="text-[13px] font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
