import { SourcePill, StatusPill, Tile } from '@techma/ui';
import type { ProcedureDraft } from '@/lib/procedure-form';

/** « Aperçu côté usager »: the fiche as the public TextBlock would show it. */
export function UserPreview({ draft }: { draft: ProcedureDraft }) {
  const validated = draft.validationStatus === 'validated';
  return (
    <Tile tone="ink" className="flex flex-col gap-4 p-6 md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="text-[13px] font-bold tracking-[0.04em] text-on-action/80 uppercase">Aperçu côté usager</h2>
        <StatusPill status={validated ? 'submitted' : 'draft'} className="px-2.5 py-1 text-xs font-extrabold">
          {validated ? 'Citée par l’assistant' : 'Non citée tant qu’en brouillon'}
        </StatusPill>
      </div>
      <div className="flex flex-col gap-3 rounded-[22px] bg-surface p-5 text-ink">
        <p className="text-base leading-normal">
          {draft.summary}
          <sup className="ml-[3px] inline-flex rounded-md bg-sunken px-1.5 text-[11px] font-bold">1</sup>
        </p>
        {draft.requiredDocuments.length > 0 ? (
          <ul aria-label="Pièces à fournir (aperçu)" className="flex flex-wrap gap-1.5">
            {draft.requiredDocuments.map((item) => (
              <li key={item} className="rounded-pill bg-sunken px-3 py-1.5 text-[13px] font-semibold">
                {item}
              </li>
            ))}
          </ul>
        ) : null}
        <SourcePill
          index={1}
          title={draft.title}
          domain={`version ${draft.sourceVersion}`}
          className="self-start text-[13px]"
        />
      </div>
    </Tile>
  );
}
