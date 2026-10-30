'use client';

import { Button, TextField, cn } from '@techma/ui';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';

/** Required documents as removable chips, with an inline entry opened by « + Ajouter une pièce ». */
export function RequiredDocuments({
  documents,
  error,
  onChange,
  readOnly = false,
}: {
  documents: string[];
  error?: string;
  onChange: (documents: string[]) => void;
  readOnly?: boolean;
}) {
  const [entry, setEntry] = useState('');
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null); // only a new chip animates in
  const value = entry.trim();
  const duplicate = value !== '' && documents.some((item) => item.trim() === value);

  const add = () => {
    if (value === '' || duplicate) return;
    onChange([...documents, value]);
    setJustAdded(value);
    setEntry('');
  };

  return (
    <div className="flex flex-col gap-3">
      <span id="required-documents-label" className="text-[15px] font-semibold">
        Pièces à fournir
      </span>
      <ul aria-labelledby="required-documents-label" className="flex flex-wrap items-center gap-2">
        {documents.map((item) => (
          <li
            key={item}
            className={cn(
              'inline-flex min-h-11 items-center gap-1 rounded-pill bg-sunken py-0 pr-1.5 pl-4 text-sm font-semibold',
              item === justAdded && 'ui-pop',
            )}
          >
            {item}
            <button
              type="button"
              aria-label={`Retirer ${item}`}
              disabled={readOnly}
              onClick={() => onChange(documents.filter((d) => d !== item))}
              className="ui-press inline-flex size-9 items-center justify-center rounded-pill hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            aria-expanded={adding}
            disabled={readOnly}
            onClick={() => setAdding((open) => !open)}
            className="ui-press inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-dashed border-field bg-surface px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus aria-hidden="true" className="size-4" />
            Ajouter une pièce
          </button>
        </li>
      </ul>
      {documents.length === 0 ? <p className="text-sm text-ink-muted">Aucune pièce requise.</p> : null}
      {error ? <p className="text-[13px] font-semibold text-danger">{error}</p> : null}
      {adding && !readOnly ? (
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <TextField
              label="Nom de la pièce"
              value={entry}
              autoFocus
              error={duplicate ? 'Cette pièce figure déjà dans la liste.' : undefined}
              onChange={(event) => setEntry(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  add();
                } else if (event.key === 'Escape') {
                  setAdding(false);
                }
              }}
            />
          </div>
          <Button variant="secondary" disabled={value === '' || duplicate} onClick={add}>
            Ajouter
          </Button>
        </div>
      ) : null}
    </div>
  );
}
