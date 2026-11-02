import { Tile } from '@techma/ui';
import { FileText } from 'lucide-react';
import type { DraftRequest } from '@/lib/dossier';

/** In the thread: a short note that the draft moved. The detail lives in the « Vos informations » panel. */
export function RequestCardBlock({ block }: { block: { type: 'requestCard'; request: DraftRequest } }) {
  const { request } = block;
  return (
    <Tile tone="outline" role="region" aria-label="Votre demande" className="flex items-start gap-3 rounded-[20px] p-5 md:p-5">
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-trust-soft text-trust-text">
        <FileText className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="m-0 break-words text-[15px] font-semibold">{request.title}</p>
        <p className="m-0 text-[14px] text-ink-muted">
          {request.missing.length === 0
            ? 'Tout est prêt pour le dépôt. Détail dans « Vos informations ».'
            : `Il manque : ${request.missing.join(', ')}. Détail dans « Vos informations ».`}
        </p>
      </div>
    </Tile>
  );
}
