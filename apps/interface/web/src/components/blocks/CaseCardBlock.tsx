import { Button, StatusPill, Tile } from '@techma/ui';
import { Download } from 'lucide-react';
import { caseDocumentHref } from '@/lib/c1-client';
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_PILL,
  administrationLabel,
  formatDateFr,
  issuedDocuments,
  paymentSummary,
  type Case,
} from '@/lib/cases';

/** « Simulation » mark: a case reference is always a simulated one (CONTRACTS.md §1.2). */
export function SimulationMark({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill border border-current px-2 py-0.5 text-[12px] font-bold uppercase tracking-wide ${className ?? ''}`}
    >
      Simulation
    </span>
  );
}

/** Reference of a case with the « Simulation » mark when `simulated`. */
export function CaseReference({ item }: { item: Pick<Case, 'reference' | 'simulated'> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="break-all font-mono text-[14px]">{item.reference}</span>
      {item.simulated && <SimulationMark />}
    </span>
  );
}

/** Full content of a case: shared by the `caseCard` block and the « Mes démarches » detail. */
export function CaseCard({ item, heading: Heading = 'h2' }: { item: Case; heading?: 'h2' | 'h3' }) {
  const documents = issuedDocuments(item);
  return (
    <Tile
      tone="outline"
      role="region"
      aria-label="État du dossier"
      className="flex flex-col gap-4 rounded-[28px] p-7 md:p-7"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusPill status={CASE_STATUS_PILL[item.status]}>{CASE_STATUS_LABELS[item.status]}</StatusPill>
        <CaseReference item={item} />
      </div>
      <Heading className="m-0 font-display text-[24px] font-extrabold leading-[1.15] tracking-[-0.03em]">{item.title}</Heading>
      <dl className="m-0 grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-[auto_1fr]">
        <dt className="text-ink-muted">Administration</dt>
        <dd className="m-0 font-semibold">{administrationLabel(item.administrationId)}</dd>
        <dt className="text-ink-muted">Paiement</dt>
        <dd className="m-0 font-semibold">{paymentSummary(item.payment)}</dd>
        <dt className="text-ink-muted">Dernière mise à jour</dt>
        <dd className="m-0 font-semibold">{formatDateFr(item.updatedAt)}</dd>
      </dl>
      {item.status === 'information_requested' && item.informationRequest && (
        <div role="note" className="rounded-2xl bg-sun p-4 text-[15px] leading-[1.5]">
          <p className="m-0 mb-1 font-semibold">Complément demandé</p>
          <p className="m-0 whitespace-pre-wrap break-words">{item.informationRequest.note}</p>
        </div>
      )}
      {item.status === 'rejected' && item.decisionNote && (
        <p className="m-0 whitespace-pre-wrap break-words text-[15px] leading-[1.5]">{item.decisionNote}</p>
      )}
      {documents.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[15px] font-semibold">Documents délivrés</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {documents.map((document) => (
              <li key={document.id}>
                <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal text-left">
                  <a href={caseDocumentHref(item.id, document.id)} download>
                    <Download aria-hidden="true" className="size-4 shrink-0" />
                    <span className="min-w-0 break-words">{document.name}</span>
                    <span className="sr-only"> (télécharger)</span>
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Tile>
  );
}

export function CaseCardBlock({ block }: { block: { type: 'caseCard'; case: Case } }) {
  return <CaseCard item={block.case} />;
}
