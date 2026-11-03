import type { Schemas } from '@techma/contracts-ts';
import type { SourceInfo } from '@techma/ui';
import type { TimelineEntry } from './conversation-state';
import { formatDateFr, safeHttpUrl } from './safe-url';

type Block = Schemas['Block'];
type Source = Schemas['Source'];
export type DraftRequest = Schemas['Request'];

function agentBlocks(timeline: TimelineEntry[]): Block[] {
  return timeline.flatMap((entry) => (entry.kind === 'agent' ? entry.message.blocks : []));
}

/** The draft shown in the « Vos informations » panel: the latest `requestCard` of the conversation (null before any). */
export function latestRequest(timeline: TimelineEntry[]): DraftRequest | null {
  const card = agentBlocks(timeline).filter((b) => b.type === 'requestCard').at(-1);
  return card?.type === 'requestCard' ? card.request : null;
}

/** Sources of the last text block of the conversation (empty when there is none). */
export function lastTextSources(timeline: TimelineEntry[]): Source[] {
  const last = agentBlocks(timeline).filter((b) => b.type === 'text').at(-1);
  return last?.type === 'text' ? last.sources : [];
}

/**
 * Quick action offered under the last agent message when it presents one procedure and nothing else
 * is pending (no interactive block, no draft or case yet). Null otherwise.
 */
export function prepareRequestAction(timeline: TimelineEntry[]): { procedureId: string } | null {
  const last = timeline[timeline.length - 1];
  if (last?.kind !== 'agent') return null;
  const all = agentBlocks(timeline);
  if (all.some((b) => b.type === 'requestCard' || b.type === 'caseCard')) return null;
  const blocks = last.message.blocks;
  if (blocks.some((b) => b.type !== 'text')) return null;
  const ids = new Set<string>();
  for (const b of blocks) if (b.type === 'text') for (const s of b.sources) ids.add(s.procedureId);
  if (ids.size !== 1) return null;
  return { procedureId: [...ids][0] };
}

/** Contract `Source` → design-system `SourceInfo` (no title in the contract: the procedure id is used). */
export function toSourceInfo(source: Source, index: number, withDate = false): SourceInfo {
  const url = safeHttpUrl(source.url);
  return {
    index: index + 1,
    title: source.procedureId,
    domain: url ? url.hostname : source.url,
    href: url?.href,
    ...(withDate && { retrievedAtLabel: `Consultée le ${formatDateFr(source.retrievedAt)}` }),
  };
}
