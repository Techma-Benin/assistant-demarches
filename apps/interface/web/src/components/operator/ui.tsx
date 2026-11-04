'use client';

import { Toast, VisuallyHidden, cn } from '@techma/ui';
import { useCallback, useId, useState, type ReactNode, type SelectHTMLAttributes } from 'react';

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-80">
        <h1 className="font-display text-[clamp(26px,3vw,34px)] leading-[1.05] font-extrabold tracking-[-0.03em] break-words">
          {title}
        </h1>
        {description ? <p className="mt-1.5 text-[15px] text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}

export type ToastAction = { label: string; onClick: () => void };

/** Message for the `Toast`, with an optional way back; `show` and `dismiss` are stable (the Toast timer depends on `dismiss`). */
export function useToast() {
  const [state, setState] = useState<{ message: string; action?: ToastAction } | null>(null);
  const show = useCallback((message: string, action?: ToastAction) => setState({ message, action }), []);
  const dismiss = useCallback(() => setState(null), []);
  return { message: state?.message ?? null, action: state?.action, show, dismiss };
}

export function ToastViewport({ toast }: { toast: ReturnType<typeof useToast> }) {
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex justify-center *:pointer-events-auto">
      <Toast message={toast.message} action={toast.action} onDismiss={toast.dismiss} />
    </div>
  );
}

/** Open state of a dialog plus its target, kept while the dialog fades out. */
export function useDialogTarget<T>() {
  const [target, setTarget] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const show = useCallback((next: T) => {
    setTarget(next);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return { target, open, show, close, onOpenChange: setOpen };
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
