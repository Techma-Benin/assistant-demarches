import { useId } from 'react';
import { Check, Circle } from 'lucide-react';
import type { DraftRequest } from '@/lib/dossier';

const SOURCE_LABELS = { answer: 'Votre réponse', document: 'Lu dans votre pièce' } as const;

function displayValue(value: string | number | boolean | null): string {
  if (value === null) return 'Non renseigné';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  return String(value);
}

/** « Vos informations » panel: the fields of the draft with their provenance, its documents and what is missing. */
export function RequestPanel({ request, titleClassName }: { request: DraftRequest; titleClassName: string }) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-info`} className="flex flex-col gap-5 rounded-card bg-sunken p-5">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-info`} className={titleClassName}>
          Vos informations
        </h2>
        <p className="m-0 break-words text-[14px] text-ink-muted">{request.title}</p>
      </div>
      {request.fields.length > 0 && (
        <dl className="m-0 flex flex-col gap-3">
          {request.fields.map((field) => (
            <div key={field.name} className="flex flex-col gap-0.5">
              <dt className="text-[13px] text-ink-muted">{field.label}</dt>
              <dd className="m-0 break-words text-[15px] font-semibold">{displayValue(field.value)}</dd>
              {field.source && <dd className="m-0 text-[12px] text-ink-muted">{SOURCE_LABELS[field.source]}</dd>}
            </div>
          ))}
        </dl>
      )}
      {request.documents.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-[15px] font-semibold">Pièces</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {request.documents.map((document) => (
              <li key={document.documentType} className="flex items-start gap-2 text-[14px]">
                {document.fileId ? (
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-trust-text" strokeWidth={2.6} />
                ) : (
                  <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                )}
                <span className="min-w-0 break-words">
                  {document.label}
                  <span className="text-ink-muted">{document.fileId ? ' · reçue' : ' · à ajouter'}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {request.missing.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-[15px] font-semibold">Il manque encore</h3>
          <ul className="m-0 list-disc space-y-1 pl-5 text-[14px]">
            {request.missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
