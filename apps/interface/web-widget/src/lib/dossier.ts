import type { components } from '@techma/contracts-ts';
import type { SourceInfo, Step } from '@techma/ui';
import type { TimelineEntry } from './conversation-state';
import { formatDateFr, safeHttpUrl } from './safe-url';

type Schemas = components['schemas'];
type Block = Schemas['Block'];
type Source = Schemas['Source'];
type RequestStatus = Schemas['RequestStatus'];

const PORTAL_DONE: readonly RequestStatus[] = ['submitted', 'processing', 'completed'];

function agentBlocks(timeline: TimelineEntry[]): Block[] {
  return timeline.flatMap((entry) => (entry.kind === 'agent' ? entry.message.blocks : []));
}

/**
 * Side-panel steps, derived from the timeline. `null` until the user is engaged in a request (consent flow,
 * form, file request, status card or created request): a plain Q&A has no dossier. Once engaged, the whole path
 * is shown, future steps included; exactly one step is `current` (the first one not done).
 */
export function deriveDossierSteps(
  timeline: TimelineEntry[],
  consent?: 'pending' | 'active',
  requestCreated = false,
): Step[] | null {
  const blocks = agentBlocks(timeline);
  const formIds = new Set(blocks.flatMap((b) => (b.type === 'form' ? [b.id] : [])));
  const hasFileRequest = blocks.some((b) => b.type === 'fileRequest');
  const statusCards = blocks.flatMap((b) => (b.type === 'statusCard' ? [b] : []));
  const lastStatus = statusCards.at(-1)?.request.status;
  const hasStatusCard = statusCards.length > 0;

  if (consent === undefined && formIds.size === 0 && !hasFileRequest && !hasStatusCard && !requestCreated) return null;

  const formDone = timeline.some(
    (e) => e.kind === 'user' && e.content?.type === 'interaction' && formIds.has(e.content.actionId),
  );
  const filesSent = timeline.filter((e) => e.kind === 'user' && e.attachment !== undefined && e.content !== null).length;
  const fileDone = filesSent > 0;
  const sourced = blocks.some((b) => b.type === 'text' && b.sources.length > 0);
  const procedureDone = sourced || requestCreated || hasStatusCard;
  const consentDone = consent === 'active' || requestCreated || hasStatusCard;

  const steps: { label: string; done: boolean; description?: string }[] = [
    { label: 'Démarche identifiée', done: procedureDone, description: procedureDone ? 'Fiche officielle trouvée' : undefined },
    {
      label: 'Autorisation',
      done: consentDone,
      description: consentDone ? 'Accordée' : consent === 'pending' ? 'À donner' : 'À venir',
    },
  ];
  if (!hasStatusCard || formIds.size > 0) {
    steps.push({
      label: 'Vos informations',
      done: formDone,
      description: formDone ? 'Enregistrées' : formIds.size > 0 ? 'À compléter' : 'À venir',
    });
  }
  if (!hasStatusCard || hasFileRequest) {
    steps.push({
      label: 'Pièces justificatives',
      done: fileDone,
      description: fileDone
        ? filesSent > 1
          ? `${filesSent} fichiers joints`
          : '1 fichier joint'
        : hasFileRequest
          ? 'À ajouter'
          : 'À venir',
    });
  }
  steps.push({
    label: 'Validation sur le portail',
    done: lastStatus !== undefined && PORTAL_DONE.includes(lastStatus),
    description: 'Par vous, sur le portail officiel',
  });

  const currentIndex = steps.findIndex((s) => !s.done);
  return steps.map(({ label, done, description }, index) => ({
    label,
    description,
    status: done ? 'done' : index === currentIndex ? 'current' : 'todo',
  }));
}

/** Sources of the last text block of the conversation (empty when there is none). */
export function lastTextSources(timeline: TimelineEntry[]): Source[] {
  const last = agentBlocks(timeline).filter((b) => b.type === 'text').at(-1);
  return last?.type === 'text' ? last.sources : [];
}

/** Contract `Source` → design-system `SourceInfo` (no title in the contract: the procedure id is used). */
export function toSourceInfo(source: Source, index: number, withDate = false): SourceInfo {
  const url = safeHttpUrl(source.url);
  return {
    index: index + 1,
    title: source.procedureId,
    domain: url ? url.hostname : source.url,
    href: url?.href,
    version: source.version,
    ...(withDate && { retrievedAtLabel: `Consultée le ${formatDateFr(source.retrievedAt)}` }),
  };
}
