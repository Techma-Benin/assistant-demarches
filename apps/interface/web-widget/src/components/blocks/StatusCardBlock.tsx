import { Button, StatusPill, Tile } from '@techma/ui';
import { ArrowUpRight, ExternalLink } from 'lucide-react';
import type { components } from '@techma/contracts-ts';
import { formatDateFr, safeHttpUrl } from '@/lib/safe-url';

type Schemas = components['schemas'];
type Props = { block: Extract<Schemas['Block'], { type: 'statusCard' }> };
type RequestStatus = Schemas['RequestStatus'];
type PillStatus = NonNullable<React.ComponentProps<typeof StatusPill>['status']>;

export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: 'Brouillon',
  ready: 'Prête',
  awaiting_user_validation: 'À valider sur le portail officiel',
  submitted: 'Transmise',
  processing: 'En traitement',
  completed: 'Terminée',
  rejected: 'Rejetée',
  cancelled: 'Annulée',
};

const PILL_STATUS: Record<RequestStatus, PillStatus> = {
  draft: 'draft',
  ready: 'info',
  awaiting_user_validation: 'toValidate',
  submitted: 'submitted',
  processing: 'info',
  completed: 'validated',
  rejected: 'danger',
  cancelled: 'danger',
};

export function StatusCardBlock({ block }: Props) {
  const { request } = block;
  const link = safeHttpUrl(request.officialLink);
  const updated = `Mise à jour le ${formatDateFr(request.updatedAt)}`;

  if (request.status === 'awaiting_user_validation') {
    return (
      <Tile
        tone="ink"
        role="region"
        aria-label="État de la demande"
        className="flex flex-col gap-6 rounded-[32px] p-7 md:p-9"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusPill status="toValidate" className="text-[13px] font-extrabold">
            À valider par vous
          </StatusPill>
          <span className="break-all font-mono text-[13px] opacity-80">Réf. {request.id}</span>
        </div>
        <h2 className="m-0 font-display text-[clamp(30px,3.4vw,44px)] font-extrabold leading-[1.02] tracking-[-0.04em]">
          Votre demande est prête.
        </h2>
        <p className="m-0 max-w-[560px] text-[17px] leading-[1.55] opacity-90">
          Il ne reste qu’une étape : la valider vous-même sur le portail officiel. C’est là, et seulement là, que vous
          saisirez votre NPI et votre code SMS.
        </p>
        {link && (
          <Button
            asChild
            size="lg"
            className="min-h-14 self-start bg-surface px-7 text-[17px] font-extrabold text-ink hover:bg-sunken"
          >
            <a href={link.href} target="_blank" rel="noopener noreferrer">
              Valider sur le portail officiel
              <ArrowUpRight aria-hidden="true" className="size-[18px]" strokeWidth={2.6} />
            </a>
          </Button>
        )}
        <p className="m-0 text-[13px] opacity-80">{updated}</p>
      </Tile>
    );
  }

  return (
    <Tile
      tone="outline"
      role="region"
      aria-label="État de la demande"
      className="flex flex-col gap-3 rounded-[28px] p-7 md:p-7"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusPill status={PILL_STATUS[request.status]}>{STATUS_LABELS[request.status]}</StatusPill>
        <span className="break-all font-mono text-[13px] text-ink-muted">Réf. {request.id}</span>
      </div>
      <p className="m-0 text-base font-semibold">Démarche : {request.procedureId}</p>
      <p className="m-0 text-[13px] text-ink-muted">{updated}</p>
      {link && (
        <Button asChild variant="outline" className="self-start">
          <a href={link.href} target="_blank" rel="noopener noreferrer">
            Ouvrir le portail officiel
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        </Button>
      )}
    </Tile>
  );
}
