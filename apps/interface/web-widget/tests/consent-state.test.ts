import { describe, expect, it } from 'vitest';
import { formatExpiry, formatExpiryShort, resolveProcedureId, scopeLabels, MANDATE_SCOPES } from '@/lib/consent';
import { conversationReducer, initialState, type ConversationState } from '@/lib/conversation-state';
import type { EventPage } from '@/lib/c1-client';
import type { TimelineEntry } from '@/lib/conversation-state';
import { deriveDossierSteps } from '@/lib/dossier';

const CNV = 'cnv_' + '0'.repeat(25) + '1';
const pad = (n: number) => String(n).padStart(26, '0');
const base = {
  specversion: '1.0' as const,
  source: 'urn:techma:backend',
  time: '2026-10-22T18:00:00Z',
  datacontenttype: 'application/json' as const,
  traceparent: '00-' + '1'.repeat(32) + '-' + '2'.repeat(16) + '-01',
};
type Item = EventPage['items'][number];
const tool = (evt: number, outcome: 'success' | 'error', code: string): Item =>
  ({ ...base, id: `evt_${pad(evt)}`, type: 'bj.techma.tool.called.v1', data: { kind: 'tool.called', toolName: 'request.create', conversationId: CNV, outcome, code } }) as Item;
const sent = (evt: number, msg: number, sources: { procedureId: string }[] = []): Item =>
  ({
    ...base,
    id: `evt_${pad(evt)}`,
    type: 'bj.techma.message.sent.v1',
    data: {
      kind: 'message.sent',
      conversationId: CNV,
      message: {
        id: `msg_${pad(msg)}`,
        conversationId: CNV,
        blocks: [{ type: 'text', text: 'x', sources: sources.map((s) => ({ ...s, url: 'https://example.org', retrievedAt: base.time, version: 'v1' })) }],
        createdAt: base.time,
      },
    },
  }) as Item;
const created = (evt: number, procedureId: string): Item =>
  ({
    ...base,
    id: `evt_${pad(evt)}`,
    type: 'bj.techma.request.created.v1',
    data: {
      kind: 'request.created',
      request: { id: 'req_' + pad(1), conversationId: CNV, userRef: 'usr_' + pad(1), procedureId, status: 'draft', fields: {}, fileIds: [], officialLink: null, updatedAt: base.time },
    },
  }) as Item;

const start = (): ConversationState => conversationReducer(initialState, { type: 'conversationStarted', conversationId: CNV });
const apply = (s: ConversationState, ...items: Item[]) =>
  conversationReducer(s, { type: 'eventsReceived', page: { items, nextCursor: items.at(-1)!.id } });

describe('consent trigger (reducer)', () => {
  it.each(['MANDATE_MISSING', 'MANDATE_EXPIRED', 'MANDATE_REVOKED'])('%s sets consent needed', (code) => {
    const s = apply(start(), tool(1, 'error', code));
    expect(s.consent).toMatchObject({ status: 'needed', toolName: 'request.create', eventId: `evt_${pad(1)}`, code });
  });

  it('ignores successful and other error tool.called', () => {
    let s = apply(start(), tool(1, 'success', 'OK'));
    s = apply(s, tool(2, 'error', 'INVALID_REQUEST'));
    expect(s.consent).toBeUndefined();
  });

  it('anchors the card on the next agent message', () => {
    const s = apply(start(), tool(1, 'error', 'MANDATE_MISSING'), sent(2, 1), sent(3, 2));
    expect(s.consent?.anchorMessageId).toBe(`msg_${pad(1)}`);
  });

  it('keeps one trigger per agent turn, replaces it once announced', () => {
    let s = apply(start(), tool(1, 'error', 'MANDATE_MISSING'), tool(2, 'error', 'MANDATE_MISSING'));
    expect(s.consent?.eventId).toBe(`evt_${pad(1)}`);
    s = apply(s, sent(3, 1), tool(4, 'error', 'MANDATE_EXPIRED'));
    expect(s.consent).toMatchObject({ eventId: `evt_${pad(4)}`, code: 'MANDATE_EXPIRED', anchorMessageId: null });
  });
});

describe('resolveProcedureId', () => {
  it('is null when nothing is known', () => {
    expect(resolveProcedureId(start())).toBeNull();
  });
  it('uses the latest Source of agent text blocks', () => {
    const s = apply(start(), sent(1, 1, [{ procedureId: 'a' }, { procedureId: 'b' }]), sent(2, 2, [{ procedureId: 'c' }]));
    expect(resolveProcedureId(s)).toBe('c');
  });
  it('request.created wins over sources', () => {
    const s = apply(start(), sent(1, 1, [{ procedureId: 'src' }]), created(2, 'req-proc'));
    expect(resolveProcedureId(s)).toBe('req-proc');
  });
});

describe('scopes and dossier step', () => {
  it('requests the union of the catalog scopes', () => {
    expect(MANDATE_SCOPES).toEqual(['requests:write', 'documents:write', 'requests:submit']);
  });
  it('adds an Autorisation step: current while pending, done when active', () => {
    const timeline: TimelineEntry[] = [
      { kind: 'agent', message: { id: 'msg_1', conversationId: CNV, createdAt: base.time, blocks: [{ type: 'text', text: 't', sources: [] }] } },
    ];
    expect(deriveDossierSteps(timeline)).toBeNull();
    const sourced: TimelineEntry[] = [
      { kind: 'agent', message: { id: 'msg_1', conversationId: CNV, createdAt: base.time, blocks: [{ type: 'text', text: 't', sources: [{ procedureId: 'p', url: 'https://a.example/x', retrievedAt: base.time, version: 'v1' }] }] } },
    ];
    const pending = deriveDossierSteps(sourced, 'pending')!;
    expect(pending.find((s) => s.label === 'Autorisation')?.status).toBe('current');
    const active = deriveDossierSteps(sourced, 'active')!;
    expect(active.find((s) => s.label === 'Autorisation')?.status).toBe('done');
  });
});

describe('consent display helpers', () => {
  it('formats the expiry with the full date, and the year only when it differs', () => {
    const now = new Date(2026, 9, 31, 10, 0);
    expect(formatExpiry(new Date(2026, 9, 31, 16, 19).toISOString(), now)).toBe('samedi 31 octobre à 16:19');
    expect(formatExpiry(new Date(2027, 0, 5, 9, 5).toISOString(), now)).toBe('mardi 5 janvier 2027 à 09:05');
  });

  it('maps scopes to plain labels and skips unknown ones', () => {
    expect(scopeLabels(['requests:write', 'bogus', 'requests:submit'])).toEqual([
      'créer et remplir votre demande',
      'transmettre la demande pour que vous la validiez sur le portail officiel',
    ]);
  });
});

describe('formatExpiryShort', () => {
  const now = new Date(2026, 10, 1, 12, 0);
  it('uses the time only when the expiry is today', () => {
    expect(formatExpiryShort(new Date(2026, 10, 1, 21, 5).toISOString(), now)).toBe('jusqu’à 21:05');
  });
  it('uses the full date on another day', () => {
    expect(formatExpiryShort(new Date(2026, 10, 2, 9, 0).toISOString(), now)).toBe('jusqu’au lundi 2 novembre à 09:00');
  });
});
