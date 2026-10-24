import type { components } from '@techma/contracts-ts';
import { formatDateFr, safeHttpUrl } from '@/lib/safe-url';

type Schemas = components['schemas'];
type Props = { block: Extract<Schemas['Block'], { type: 'statusCard' }> };

export const STATUS_LABELS: Record<Schemas['RequestStatus'], string> = {
  draft: 'Brouillon',
  ready: 'Prête',
  awaiting_user_validation: 'À valider sur le portail officiel',
  submitted: 'Déposée',
  processing: 'En traitement',
  completed: 'Terminée',
  rejected: 'Rejetée',
  cancelled: 'Annulée',
};

export function StatusCardBlock({ block }: Props) {
  const { request } = block;
  const link = safeHttpUrl(request.officialLink);
  return (
    <section aria-label="État de la demande" className="space-y-1 rounded border border-slate-300 bg-white p-3">
      <p className="text-xs text-slate-500">Démarche : {request.procedureId}</p>
      <p className="font-semibold">{STATUS_LABELS[request.status]}</p>
      <p className="text-xs text-slate-600">Mise à jour le {formatDateFr(request.updatedAt)}</p>
      {link && (
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm text-blue-700 underline"
        >
          Ouvrir le portail officiel
        </a>
      )}
    </section>
  );
}
