import type { Schemas } from '@techma/contracts-ts';
import { describe, expect, it } from 'vitest';
import type { TimelineEntry } from '@/lib/conversation-state';
import { latestRequest, lastTextSources, openFileRequests, receivedFileRequests, toSourceInfo } from '@/lib/dossier';
import { caseCardBlock, consentBlock, exampleRequest, fileRequestBlock, msgId, requestCardBlock } from './fixtures-v2';

type Block = Schemas['Block'];

const agent = (n: number, ...blocks: Block[]): TimelineEntry => ({
  kind: 'agent',
  message: { id: msgId(n), conversationId: 'cnv_1', blocks, createdAt: '2026-11-02T18:00:00Z' } as never,
});
const user = (n: number): TimelineEntry => ({
  kind: 'user',
  id: `usr_${n}`,
  content: { type: 'text', text: 'q' },
  display: 'q',
  sentAt: '2026-11-02T18:00:00Z',
  delivery: 'received',
});
const text = (sources: Schemas['Source'][] = []): Block => ({ type: 'text', text: 't', sources });
const form: Block = { type: 'form', id: 'f1', fields: [] };
const src = (url: string, procedureId = 'PS00373'): Schemas['Source'] => ({
  procedureId: procedureId as never,
  url,
  retrievedAt: '2026-11-02T18:00:00Z',
});

describe('latestRequest', () => {
  it('is null before any requestCard', () => {
    expect(latestRequest([user(1), agent(1, text())])).toBeNull();
  });

  it('is the request of the latest requestCard, whichever message carries it', () => {
    const older = { ...exampleRequest, missing: ['Pièce'], status: 'draft' as const };
    const newer = { ...exampleRequest, missing: [], status: 'ready' as const };
    const timeline = [agent(1, requestCardBlock(older)), user(2), agent(2, text(), requestCardBlock(newer)), agent(3, text())];
    expect(latestRequest(timeline)).toEqual(newer);
  });
});

describe('sources helpers', () => {
  it('takes the sources of the last text block only', () => {
    const a = src('https://a.example/x');
    const b = src('https://b.example/y');
    expect(lastTextSources([agent(1, text([a])), agent(2, text([b]), caseCardBlock())])).toEqual([b]);
    expect(lastTextSources([agent(1, text([a])), agent(2, text([]))])).toEqual([]);
    expect(lastTextSources([user(1)])).toEqual([]);
  });

  it('maps a source to SourceInfo with a safe href and no version', () => {
    expect(toSourceInfo(src('https://a.example/x', 'casier'), 0, true)).toEqual({
      index: 1,
      title: 'casier',
      domain: 'a.example',
      href: 'https://a.example/x',
      retrievedAtLabel: 'Consultée le 02/11/2026',
    });
    expect(toSourceInfo(src('javascript:alert(1)'), 1).href).toBeUndefined();
  });
});

describe('openFileRequests / receivedFileRequests', () => {
  const KEY = `${exampleRequest.id}:extrait-acte-naissance`;
  const FILE = 'fil_01JD0000000000000000000001' as never;
  const card = (over: Partial<typeof exampleRequest>, fileId: unknown = null) =>
    requestCardBlock({ ...exampleRequest, documents: [{ ...exampleRequest.documents[0], fileId: fileId as never }], ...over });

  it.each(['draft', 'ready'] as const)('opens a missing document of a %s request', (status) => {
    const timeline = [agent(1, card({ status }))];
    expect(openFileRequests(timeline)).toEqual(new Set([KEY]));
    expect(receivedFileRequests(timeline).size).toBe(0);
  });

  it('closes it once submitted or filed as a case', () => {
    expect(openFileRequests([agent(1, card({ status: 'submitted' }))]).size).toBe(0);
    expect(openFileRequests([agent(1, card({ status: 'ready', caseId: 'cas_01JD0000000000000000000001' as never }))]).size).toBe(0);
  });

  it('lets the newest card of a request override the older one', () => {
    const timeline = [agent(1, card({ status: 'draft' })), user(1), agent(2, card({ status: 'ready' }, FILE))];
    expect(openFileRequests(timeline).size).toBe(0);
    expect(receivedFileRequests(timeline)).toEqual(new Set([KEY]));
  });

  it('keeps requests apart', () => {
    const other = { id: 'req_01JD0000000000000000000002' as never };
    const timeline = [agent(1, card({ status: 'draft' }), card({ ...other, status: 'draft' }, FILE))];
    expect(openFileRequests(timeline)).toEqual(new Set([KEY]));
    expect(receivedFileRequests(timeline)).toEqual(new Set(['req_01JD0000000000000000000002:extrait-acte-naissance']));
  });

  it('is empty without any card', () => {
    expect(openFileRequests([user(1), agent(1, fileRequestBlock())]).size).toBe(0);
  });
});
