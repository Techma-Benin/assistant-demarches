'use client';

import { useId, useState, type FormEvent } from 'react';
import type { components } from '@techma/contracts-ts';

type Block = components['schemas']['Block'];
type Props = {
  block: Extract<Block, { type: 'form' }>;
  interactive: boolean;
  onForm: (formId: string, values: Record<string, string>, summary: string) => void;
};

export function FormBlock({ block, interactive, onForm }: Props) {
  const [submitted, setSubmitted] = useState(false);
  const baseId = useId();
  const disabled = !interactive || submitted;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const data = new FormData(event.currentTarget);
    const values: Record<string, string> = {};
    for (const field of block.fields) {
      values[field.name] = String(data.get(field.name) ?? '');
    }
    setSubmitted(true);
    onForm(block.id, values, 'Formulaire envoyé');
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <fieldset disabled={disabled} className="space-y-3">
        {block.fields.map((field) => {
          const inputId = `${baseId}-${field.name}`;
          return (
            <div key={field.name}>
              <label htmlFor={inputId} className="block text-sm font-medium">
                {field.label}
                {field.required && <span aria-hidden="true"> *</span>}
              </label>
              <input
                id={inputId}
                name={field.name}
                type={field.type}
                required={field.required}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
              />
            </div>
          );
        })}
        <button
          type="submit"
          className="rounded bg-blue-700 px-3 py-1 text-sm text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Valider
        </button>
      </fieldset>
    </form>
  );
}
