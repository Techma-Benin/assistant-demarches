'use client';

import { useId, useState, type FormEvent } from 'react';
import { Button, TextField, Tile } from '@techma/ui';
import { Check } from 'lucide-react';
import type { components } from '@techma/contracts-ts';

type Block = components['schemas']['Block'];
type Props = {
  block: Extract<Block, { type: 'form' }>;
  interactive: boolean;
  onForm: (formId: string, values: Record<string, string>, summary: string) => void;
};

// The form schema carries no step counter: no « Étape n sur N » here.
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
    <Tile tone="outline" className="flex flex-col gap-5 rounded-[28px] p-7 md:p-7">
      <h2 className="m-0 font-display text-[28px] font-extrabold tracking-[-0.035em]">Vos informations</h2>
      {submitted ? (
        <p role="status" className="m-0 flex items-center gap-2.5 text-base font-semibold text-trust-text">
          <Check aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.6} />
          Informations enregistrées
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            {block.fields.map((field) => (
              <TextField
                key={field.name}
                id={`${baseId}-${field.name}`}
                name={field.name}
                type={field.type}
                label={field.label}
                required={field.required}
                className="h-14 rounded-2xl px-[18px] text-[17px]"
              />
            ))}
            <Button type="submit" size="lg" className="min-h-[52px] self-start px-7 font-bold">
              Continuer
            </Button>
          </fieldset>
        </form>
      )}
    </Tile>
  );
}
