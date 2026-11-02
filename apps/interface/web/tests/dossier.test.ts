import type { Schemas } from '@techma/contracts-ts';
import { describe, expect, it } from 'vitest';
import type { TimelineEntry } from '@/lib/conversation-state';
import { latestRequest, prepareRequestAction, lastTextSources, toSourceInfo } from '@/lib/dossier';
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

describe('prepareRequestAction', () => {
  it('returns the procedure when the last agent message cites exactly one', () => {
    expect(prepareRequestAction([user(1), agent(1, text([src('https://x.fr', 'F1'), src('https://x.fr', 'F1')]))])).toEqual({ procedureId: 'F1' });
  });
  it('is null when the last entry is a user message', () => {
    expect(prepareRequestAction([agent(1, text([src('https://x.fr', 'F1')])), user(2)])).toBeNull();
  });
  it('is null with two procedures or none', () => {
    expect(prepareRequestAction([agent(1, text([src('https://x.fr', 'F1'), src('https://x.fr', 'F2')]))])).toBeNull();
    expect(prepareRequestAction([agent(1, text())])).toBeNull();
  });
  it('is null with any other block in the message', () => {
    const cited = text([src('https://x.fr', 'F1')]);
    expect(prepareRequestAction([agent(1, cited, form)])).toBeNull();
    expect(prepareRequestAction([agent(1, cited, fileRequestBlock())])).toBeNull();
    expect(prepareRequestAction([agent(1, cited, consentBlock())])).toBeNull();
  });
  it('is null once a draft or a case exists in the conversation', () => {
    const cited = agent(2, text([src('https://x.fr', 'F1')]));
    expect(prepareRequestAction([agent(1, requestCardBlock()), user(1), cited])).toBeNull();
    expect(prepareRequestAction([agent(1, caseCardBlock()), user(1), cited])).toBeNull();
  });
});
