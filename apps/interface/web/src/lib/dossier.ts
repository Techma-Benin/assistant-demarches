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

type FileRequestBlock = Extract<Block, { type: 'fileRequest' }>;

/** Identity of a requested document across the conversation. */
export const fileRequestKey = (block: Pick<FileRequestBlock, 'requestId' | 'documentType'>) => `${block.requestId}:${block.documentType}`;

/** The latest `requestCard` of each request id. */
function latestCards(timeline: TimelineEntry[]): DraftRequest[] {
  const byId = new Map<string, DraftRequest>();
  for (const block of agentBlocks(timeline)) if (block.type === 'requestCard') byId.set(block.request.id, block.request);
  return [...byId.values()];
}

/** `requestId:documentType` of documents still missing from a draft not yet filed (latest card of each request). */
export function openFileRequests(timeline: TimelineEntry[]): Set<string> {
  const open = new Set<string>();
  for (const request of latestCards(timeline)) {
    if ((request.status !== 'draft' && request.status !== 'ready') || request.caseId !== null) continue;
    for (const document of request.documents) if (document.fileId === null) open.add(`${request.id}:${document.documentType}`);
  }
  return open;
}

/** `requestId:documentType` of documents the latest card of their request shows as received. */
export function receivedFileRequests(timeline: TimelineEntry[]): Set<string> {
  const received = new Set<string>();
  for (const request of latestCards(timeline)) {
    for (const document of request.documents) if (document.fileId !== null) received.add(`${request.id}:${document.documentType}`);
  }
  return received;
}

/** For each requested document, the position (`entry:block`) of its most recent `fileRequest` block: only that one stays active. */
export function latestFileRequestSlots(timeline: TimelineEntry[]): Map<string, string> {
  const slots = new Map<string, string>();
  timeline.forEach((entry, index) => {
    if (entry.kind !== 'agent') return;
    entry.message.blocks.forEach((block, blockIndex) => {
      if (block.type === 'fileRequest') slots.set(fileRequestKey(block), `${index}:${blockIndex}`);
    });
  });
  return slots;
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
    ...(withDate && { retrievedAtLabel: `Consultée le ${formatDateFr(source.retrievedAt)}` }),
  };
}
