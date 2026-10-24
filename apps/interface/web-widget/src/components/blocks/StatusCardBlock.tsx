import { Badge, Button, Card } from '@techma/ui';
import { ExternalLink } from 'lucide-react';
import type { components } from '@techma/contracts-ts';
import { formatDateFr, safeHttpUrl } from '@/lib/safe-url';

type Schemas = components['schemas'];
type Props = { block: Extract<Schemas['Block'], { type: 'statusCard' }> };
type RequestStatus = Schemas['RequestStatus'];

export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: 'Brouillon',
  ready: 'Prête',
  awaiting_user_validation: 'À valider sur le portail officiel',
  submitted: 'Déposée',
  processing: 'En traitement',
  completed: 'Terminée',
  rejected: 'Rejetée',
  cancelled: 'Annulée',
};

const STATUS_TONES: Record<RequestStatus, 'default' | 'trust' | 'warning' | 'danger'> = {
  draft: 'default',
  ready: 'default',
  awaiting_user_validation: 'warning',
  submitted: 'default',
  processing: 'default',
  completed: 'trust',
  rejected: 'danger',
  cancelled: 'danger',
};

const BADGE_TONES = { default: 'neutral', trust: 'trust', warning: 'warning', danger: 'danger' } as const;

export function StatusCardBlock({ block }: Props) {
  const { request } = block;
  const link = safeHttpUrl(request.officialLink);
  const tone = STATUS_TONES[request.status];
  return (
    <Card role="region" aria-label="État de la demande" tone={tone} className="space-y-2">
      <Badge tone={BADGE_TONES[tone]}>{STATUS_LABELS[request.status]}</Badge>
      <p className="text-base font-semibold">Démarche : {request.procedureId}</p>
      <p className="text-[13px] text-ink-muted">Mise à jour le {formatDateFr(request.updatedAt)}</p>
      {link && (
        <Button asChild className="mt-1">
          <a href={link.href} target="_blank" rel="noopener noreferrer">
            Ouvrir le portail officiel
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        </Button>
      )}
    </Card>
  );
}
