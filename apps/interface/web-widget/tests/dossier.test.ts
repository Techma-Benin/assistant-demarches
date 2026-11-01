import type { components } from '@techma/contracts-ts';
import { describe, expect, it } from 'vitest';
import type { TimelineEntry } from '@/lib/conversation-state';
import { deriveDossierSteps, lastTextSources, toSourceInfo } from '@/lib/dossier';

type Block = components['schemas']['Block'];
type RequestStatus = components['schemas']['RequestStatus'];

const agent = (n: number, ...blocks: Block[]): TimelineEntry => ({
  kind: 'agent',
  message: { id: `msg_${n}`, conversationId: 'cnv_1', blocks, createdAt: '2026-10-22T18:00:00Z' },
});
const user = (n: number, extra: Partial<Extract<TimelineEntry, { kind: 'user' }>> = {}): TimelineEntry => ({
  kind: 'user',
  id: `usr_${n}`,
  content: { type: 'text', text: 'q' },
  display: 'q',
  sentAt: '2026-10-22T18:00:00Z',
  delivery: 'received',
  ...extra,
});
const text = (sources: components['schemas']['Source'][] = []): Block => ({ type: 'text', text: 't', sources });
const form: Block = { type: 'form', id: 'f1', fields: [] };
const fileRequest: Block = { type: 'fileRequest', documentType: 'id', label: 'Pièce', acceptedMimeTypes: ['application/pdf'] };
const card = (status: RequestStatus): Block => ({
  type: 'statusCard',
  request: {
    id: 'req_1',
    conversationId: 'cnv_1',
    userRef: 'usr_1',
    procedureId: 'p',
    status,
    fields: {},
    fileIds: [],
    officialLink: null,
    updatedAt: '2026-10-22T18:00:00Z',
  },
});
const summary = (timeline: TimelineEntry[]) => deriveDossierSteps(timeline).map((s) => `${s.label}:${s.status}`);

describe('deriveDossierSteps', () => {
  it('has a single current step before any answer', () => {
    expect(summary([user(1)])).toEqual(['Question comprise:current']);
  });

  it('marks the question as understood once an agent message arrived', () => {
    expect(summary([user(1), agent(1, text())])).toEqual(['Question comprise:done']);
  });

  it('adds the form step only when a form was received, done once submitted', () => {
    const received = [user(1), agent(1, form)];
    expect(summary(received)).toEqual(['Question comprise:done', 'Vos informations:current']);
    const submitted = [...received, user(2, { content: { type: 'interaction', actionId: 'f1', value: '{}' } })];
    expect(summary(submitted)).toEqual(['Question comprise:done', 'Vos informations:done']);
    const button = [...received, user(2, { content: { type: 'interaction', actionId: 'other' } })];
    expect(summary(button)[1]).toBe('Vos informations:current');
  });

  it('marks the file done only once the attachment is accepted', () => {
    const base = [user(1), agent(1, fileRequest)];
    const attachment = { name: 'a.pdf', sizeBytes: 3, mimeType: 'application/pdf' };
    const upload = (e: Partial<Extract<TimelineEntry, { kind: 'user' }>>) => [...base, user(2, { attachment, ...e })];
    expect(summary(base)).toEqual(['Question comprise:done', 'Pièce d’identité:current']);
    expect(summary(upload({ content: null, delivery: 'uploading' }))[1]).toBe('Pièce d’identité:current');
    expect(summary(upload({ content: null, delivery: 'uploadFailed' }))[1]).toBe('Pièce d’identité:current');
    expect(summary(upload({ delivery: 'received' }))[1]).toBe('Pièce d’identité:done');
  });

  it('derives the portal step from the last status card', () => {
    const at = (status: RequestStatus) => summary([user(1), agent(1, card('draft')), agent(2, card(status))]);
    expect(at('awaiting_user_validation')).toEqual([
      'Question comprise:done',
      'Validation sur le portail:current',
    ]);
    expect(at('submitted')[1]).toBe('Validation sur le portail:done');
    expect(at('processing')[1]).toBe('Validation sur le portail:done');
    expect(at('completed')[1]).toBe('Validation sur le portail:done');
    expect(at('rejected')[1]).toBe('Validation sur le portail:current');
  });

  it('keeps exactly one current step: the first one not done', () => {
    const steps = deriveDossierSteps([user(1), agent(1, form, fileRequest, card('awaiting_user_validation'))]);
    expect(steps.map((s) => s.status)).toEqual(['done', 'current', 'todo', 'todo']);
  });
});

describe('sources helpers', () => {
  const src = (url: string, procedureId = 'p') => ({ procedureId, url, retrievedAt: '2026-10-22T18:00:00Z', version: 'v1' });

  it('takes the sources of the last text block only', () => {
    const a = src('https://a.example/x');
    const b = src('https://b.example/y');
    expect(lastTextSources([agent(1, text([a])), agent(2, text([b]), card('draft'))])).toEqual([b]);
    expect(lastTextSources([agent(1, text([a])), agent(2, text([]))])).toEqual([]);
    expect(lastTextSources([user(1)])).toEqual([]);
  });

  it('maps a source to SourceInfo with a safe href', () => {
    expect(toSourceInfo(src('https://a.example/x', 'casier'), 0, true)).toEqual({
      index: 1,
      title: 'casier',
      domain: 'a.example',
      href: 'https://a.example/x',
      version: 'v1',
      retrievedAtLabel: 'Consultée le 22/10/2026',
    });
    expect(toSourceInfo(src('javascript:alert(1)'), 1).href).toBeUndefined();
  });
});
