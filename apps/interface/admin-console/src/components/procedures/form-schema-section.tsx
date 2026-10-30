'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextArea,
} from '@techma/ui';
import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { describeFormSchema, parseFormSchema } from '@/lib/procedure-form';

/** Read-only table of the form fields; the raw JSON sits behind « Modifier le JSON ». */
export function FormSchemaSection({
  text,
  error,
  onChange,
}: {
  text: string;
  error?: string;
  onChange: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const properties = useMemo(() => {
    const parsed = parseFormSchema(text);
    return parsed.ok ? describeFormSchema(parsed.value) : null;
  }, [text]);
  const expanded = open || Boolean(error);

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[15px] font-semibold">Formulaire demandé à l’usager</span>
      {properties === null ? null : properties.length === 0 ? (
        <p className="text-sm text-ink-muted">Aucune propriété déclarée.</p>
      ) : (
        <Table aria-label="Aperçu du formulaire">
          <TableHead className="bg-shell">
            <TableRow>
              <TableHeaderCell>Champ</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Obligatoire</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {properties.map((property) => (
              <TableRow key={property.name} className="border-line-subtle">
                <TableCell className="font-mono text-[13px]">{property.name}</TableCell>
                <TableCell>{property.type}</TableCell>
                <TableCell className={property.required ? 'font-bold' : undefined}>
                  {property.required ? 'Oui' : 'Non'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="form-schema-json"
        disabled={Boolean(error)}
        onClick={() => setOpen((value) => !value)}
        className="ui-press inline-flex min-h-11 items-center gap-2 self-start rounded-pill px-3 text-sm font-semibold underline hover:bg-sunken"
      >
        <ChevronDown aria-hidden="true" className={expanded ? 'size-4 rotate-180' : 'size-4'} />
        Modifier le JSON
      </button>
      {expanded ? (
        <div id="form-schema-json">
          <TextArea
            label="Schéma du formulaire (JSON)"
            hint="Objet JSON décrivant les champs demandés à l’usager."
            rows={12}
            spellCheck={false}
            className="font-mono text-[13px]"
            value={text}
            error={error}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      ) : null}
    </div>
  );
}
