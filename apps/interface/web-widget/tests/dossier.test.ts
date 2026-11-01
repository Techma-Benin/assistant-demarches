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
const summary = (timeline: TimelineEntry[], consent?: 'pending' | 'active', requestCreated?: boolean) =>
  (deriveDossierSteps(timeline, consent, requestCreated) ?? []).map((s) => `${s.label}:${s.status}`);
const src = { procedureId: 'p', url: 'https://a.example/x', retrievedAt: '2026-10-22T18:00:00Z', version: 'v1' };

describe('deriveDossierSteps', () => {
  it('returns null for a simple Q&A', () => {
    expect(deriveDossierSteps([user(1)])).toBeNull();
    expect(deriveDossierSteps([user(1), agent(1, text([src]))])).toBeNull();
  });

  it('shows the full path once consent is pending', () => {
    const steps = deriveDossierSteps([user(1), agent(1, text([src]))], 'pending')!;
    expect(steps.map((s) => `${s.label}:${s.status}`)).toEqual([
      'Démarche identifiée:done',
      'Autorisation:current',
      'Vos informations:todo',
      'Pièces justificatives:todo',
      'Validation sur le portail:todo',
    ]);
    expect(steps[0].description).toBe('Fiche officielle trouvée');
    expect(steps[1].description).toBe('À donner');
    expect(steps[2].description).toBe('À venir');
    expect(deriveDossierSteps([user(1), agent(1, text())], 'pending')![0].status).toBe('current');
  });

  it('treats a created request as engaged, with procedure and authorization done', () => {
    expect(summary([user(1)], undefined, true).slice(0, 3)).toEqual([
      'Démarche identifiée:done',
      'Autorisation:done',
      'Vos informations:current',
    ]);
  });

  it('marks the form done once submitted', () => {
    const received = [user(1), agent(1, text([src]), form)];
    expect(summary(received, 'active')[2]).toBe('Vos informations:current');
    const submitted = [...received, user(2, { content: { type: 'interaction', actionId: 'f1', value: '{}' } })];
    expect(summary(submitted, 'active')[2]).toBe('Vos informations:done');
    const button = [...received, user(2, { content: { type: 'interaction', actionId: 'other' } })];
    expect(summary(button, 'active')[2]).toBe('Vos informations:current');
  });

  it('marks the file done only once the attachment is accepted', () => {
    const base = [
      user(1),
      agent(1, text([src]), form, fileRequest),
      user(9, { content: { type: 'interaction', actionId: 'f1', value: '{}' } }),
    ];
    const attachment = { name: 'a.pdf', sizeBytes: 3, mimeType: 'application/pdf' };
    const upload = (e: Partial<Extract<TimelineEntry, { kind: 'user' }>>) => [...base, user(2, { attachment, ...e })];
    expect(summary(base, 'active')[3]).toBe('Pièces justificatives:current');
    expect(summary(upload({ content: null, delivery: 'uploading' }), 'active')[3]).toBe('Pièces justificatives:current');
    expect(summary(upload({ content: null, delivery: 'uploadFailed' }), 'active')[3]).toBe('Pièces justificatives:current');
    expect(summary(upload({ delivery: 'received' }), 'active')[3]).toBe('Pièces justificatives:done');
    expect(deriveDossierSteps(base, 'active')![3].description).toBe('À ajouter');
    expect(deriveDossierSteps(upload({ delivery: 'received' }), 'active')![3].description).toBe('1 fichier joint');
    const two = [...upload({ delivery: 'received' }), user(3, { attachment })];
    expect(deriveDossierSteps(two, 'active')![3].description).toBe('2 fichiers joints');
  });

  it('drops the form and file steps when a status card came without them', () => {
    expect(summary([user(1), agent(1, card('draft'))])).toEqual([
      'Démarche identifiée:done',
      'Autorisation:done',
      'Validation sur le portail:current',
    ]);
    expect(summary([user(1), agent(1, form, card('draft'))])).toEqual([
      'Démarche identifiée:done',
      'Autorisation:done',
      'Vos informations:current',
      'Validation sur le portail:todo',
    ]);
  });

  it('derives the portal step from the last status card', () => {
    const at = (status: RequestStatus) => summary([user(1), agent(1, card('draft')), agent(2, card(status))]);
    expect(at('awaiting_user_validation')[2]).toBe('Validation sur le portail:current');
    expect(at('submitted')[2]).toBe('Validation sur le portail:done');
    expect(at('processing')[2]).toBe('Validation sur le portail:done');
    expect(at('completed')[2]).toBe('Validation sur le portail:done');
    expect(at('rejected')[2]).toBe('Validation sur le portail:current');
  });

  it('makes the portal step current once form and file are done', () => {
    const attachment = { name: 'a.pdf', sizeBytes: 3, mimeType: 'application/pdf' };
    const timeline = [
      user(1),
      agent(1, form, fileRequest, card('awaiting_user_validation')),
      user(2, { content: { type: 'interaction', actionId: 'f1', value: '{}' } }),
      user(3, { attachment }),
    ];
    expect(summary(timeline)).toEqual([
      'Démarche identifiée:done',
      'Autorisation:done',
      'Vos informations:done',
      'Pièces justificatives:done',
      'Validation sur le portail:current',
    ]);
  });

  it('keeps exactly one current step: the first one not done', () => {
    const steps = deriveDossierSteps([user(1), agent(1, form, fileRequest, card('awaiting_user_validation'))])!;
    expect(steps.map((s) => s.status)).toEqual(['done', 'done', 'current', 'todo', 'todo']);
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
