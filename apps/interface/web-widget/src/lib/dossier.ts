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
 * Side-panel steps, derived ONLY from the timeline. A step is present only when the matching
 * block was received; exactly one step is `current` (the first one not done).
 */
export function deriveDossierSteps(timeline: TimelineEntry[]): Step[] {
  const blocks = agentBlocks(timeline);
  const formIds = new Set(blocks.flatMap((b) => (b.type === 'form' ? [b.id] : [])));
  const hasFileRequest = blocks.some((b) => b.type === 'fileRequest');
  const statusCards = blocks.flatMap((b) => (b.type === 'statusCard' ? [b] : []));
  const lastStatus = statusCards.at(-1)?.request.status;

  const formDone = timeline.some(
    (e) => e.kind === 'user' && e.content?.type === 'interaction' && formIds.has(e.content.actionId),
  );
  const fileDone = timeline.some(
    (e) => e.kind === 'user' && e.attachment !== undefined && e.content !== null && e.delivery !== 'scanRejected',
  );

  const steps: { label: string; done: boolean; description?: string }[] = [
    { label: 'Question comprise', done: blocks.length > 0 },
  ];
  if (formIds.size > 0) {
    steps.push({ label: 'Vos informations', done: formDone, description: formDone ? 'Enregistrées' : 'À compléter' });
  }
  if (hasFileRequest) {
    steps.push({ label: 'Pièce d’identité', done: fileDone, description: fileDone ? '1 fichier joint' : 'À ajouter' });
  }
  if (lastStatus !== undefined) {
    steps.push({
      label: 'Validation sur le portail',
      done: PORTAL_DONE.includes(lastStatus),
      description: 'Par vous, sur le portail officiel',
    });
  }

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
