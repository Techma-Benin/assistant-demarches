import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '../cn';
import { VisuallyHidden } from './VisuallyHidden';

type FieldShellProps = {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: (aria: { 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
};

function FieldShell({ id, label, hint, error, required, children }: FieldShellProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[15px] font-semibold text-ink">
        {label}
        {required && (
          <>
            <span aria-hidden="true"> *</span>
            <VisuallyHidden> (obligatoire)</VisuallyHidden>
          </>
        )}
      </label>
      {hint && (
        <p id={hintId} className="text-[13px] text-ink-muted">
          {hint}
        </p>
      )}
      {children({ 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error && (
        <p id={errorId} className="text-[13px] font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const fieldClasses = (error: boolean) =>
  cn(
    'w-full rounded-field border bg-surface px-4 text-base text-ink placeholder:text-ink-subtle disabled:cursor-not-allowed disabled:opacity-60',
    error ? 'border-danger' : 'border-field',
  );

type CommonProps = { label: ReactNode; hint?: ReactNode; error?: ReactNode };

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> & CommonProps;

export function TextField({ label, hint, error, required, className, id, ...props }: TextFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
      {(aria) => (
        <input
          id={fieldId}
          required={required}
          className={cn(fieldClasses(Boolean(error)), 'min-h-11', className)}
          {...aria}
          {...props}
        />
      )}
    </FieldShell>
  );
}

export type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'children'> & CommonProps;

export function TextArea({ label, hint, error, required, className, id, rows = 3, ...props }: TextAreaProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
      {(aria) => (
        <textarea
          id={fieldId}
          rows={rows}
          required={required}
          className={cn(fieldClasses(Boolean(error)), 'min-h-11 py-2.5', className)}
          {...aria}
          {...props}
        />
      )}
    </FieldShell>
  );
}
