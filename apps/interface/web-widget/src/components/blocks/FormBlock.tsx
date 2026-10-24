'use client';

import { useId, useState, type FormEvent } from 'react';
import { Button, TextField } from '@techma/ui';
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
    <form onSubmit={handleSubmit}>
      <fieldset disabled={disabled} className="min-w-0 space-y-4">
        {block.fields.map((field) => (
          <TextField
            key={field.name}
            id={`${baseId}-${field.name}`}
            name={field.name}
            type={field.type}
            label={field.label}
            required={field.required}
          />
        ))}
        <Button type="submit" className="w-full sm:w-auto">
          Valider
        </Button>
      </fieldset>
    </form>
  );
}
