import { describe, expect, it } from 'vitest';
import type { AgentMessage, Block, ContractRequest, RequestStatus, Source } from '../src/contracts/types.js';
import { STATUS_LABELS, renderAgentMessage } from '../src/rendering/render.js';
import { splitText } from '../src/rendering/text.js';

const ctx = { now: new Date('2026-10-25T10:00:00Z') };
const source: Source = {
  procedureId: 'demo-procedure',
  url: 'https://example.org/demonstration',
  retrievedAt: '2026-10-22T18:00:00Z',
  version: 'demo-1',
};
const msg = (...blocks: Block[]): AgentMessage => ({
  id: 'msg_00000000000000000000000001',
  conversationId: 'cnv_00000000000000000000000001',
  blocks,
  createdAt: '2026-10-22T18:00:00Z',
});
const request = (over: Partial<ContractRequest> = {}): ContractRequest => ({
  id: 'req_00000000000000000000000001',
  conversationId: 'cnv_00000000000000000000000001',
  userRef: 'usr_00000000000000000000000001',
  procedureId: 'demo-procedure',
  status: 'awaiting_user_validation',
  fields: {},
  fileIds: [],
  officialLink: 'https://example.org/portail',
  updatedAt: '2026-10-22T18:00:00Z',
  ...over,
});
const bodies = (m: AgentMessage) =>
  renderAgentMessage(m, ctx).messages.map((x) => (x.type === 'text' ? x.text.body : x.interactive.body.text));

describe('renderAgentMessage', () => {
  it('rend un bloc texte avec sources', () => {
    const out = renderAgentMessage(msg({ type: 'text', text: 'Bonjour', sources: [source] }), ctx);
    expect(out.messages).toEqual([
      {
        type: 'text',
        text: {
          preview_url: false,
          body: 'Bonjour\n\nSources :\n• example.org — version demo-1, consultée le 22/10/2026 : https://example.org/demonstration',
        },
      },
    ]);
  });

  it('sans source : texte seul', () => {
    expect(bodies(msg({ type: 'text', text: 'Bonjour', sources: [] }))).toEqual(['Bonjour']);
  });

  it('n’imprime jamais une URL non http(s)', () => {
    const [body] = bodies(
      msg({ type: 'text', text: 'Voir', sources: [{ ...source, url: 'javascript:alert(1)' }] }),
    );
    expect(body).not.toContain('javascript');
    expect(body).toContain('• demo-procedure — version demo-1, consultée le 22/10/2026');
  });

  it('fusionne le texte précédent dans le corps du message à boutons (≤ 1024)', () => {
    const out = renderAgentMessage(
      msg(
        { type: 'text', text: 'Que voulez-vous faire ?', sources: [] },
        { type: 'buttons', items: [{ id: 'a', label: 'Oui' }, { id: 'b', label: 'Non' }] },
      ),
      ctx,
    );
    expect(out.messages).toEqual([
      {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: 'Que voulez-vous faire ?' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'a', title: 'Oui' } },
              { type: 'reply', reply: { id: 'b', title: 'Non' } },
            ],
          },
        },
      },
    ]);
  });

  it('ne fusionne pas un texte de plus de 1024 caractères', () => {
    const long = 'x'.repeat(1025);
    const out = renderAgentMessage(
      msg({ type: 'text', text: long, sources: [] }, { type: 'buttons', items: [{ id: 'a', label: 'Oui' }] }),
      ctx,
    );
    expect(out.messages).toHaveLength(2);
    expect(bodies(msg({ type: 'text', text: long, sources: [] }, { type: 'buttons', items: [{ id: 'a', label: 'Oui' }] }))).toEqual([
      long,
      'Choisissez une option :',
    ]);
    const exact = 'y'.repeat(1024);
    expect(bodies(msg({ type: 'text', text: exact, sources: [] }, { type: 'buttons', items: [{ id: 'a', label: 'Oui' }] }))).toEqual([exact]);
  });

  it('boutons seuls : corps par défaut ; identifiants longs raccourcis', () => {
    const longId = 'action:' + 'z'.repeat(300);
    const out = renderAgentMessage(msg({ type: 'buttons', items: [{ id: longId, label: 'Valider' }, { id: 'ok', label: 'OK' }] }), ctx);
    const first = out.messages[0]!;
    expect(first.type).toBe('interactive');
    if (first.type !== 'interactive') return;
    expect(first.interactive.body.text).toBe('Choisissez une option :');
    const ids = first.interactive.action.buttons.map((b) => b.reply.id);
    expect(ids[0]).toMatch(/^b_[0-9a-f]{12}$/);
    expect(ids[1]).toBe('ok');
    expect(out.buttonIds).toEqual({ [ids[0]!]: longId });
  });

  it('découpe un texte de plus de 4096 caractères aux limites de paragraphes', () => {
    const paragraph = 'a'.repeat(1500);
    const parts = bodies(msg({ type: 'text', text: [paragraph, paragraph, paragraph].join('\n\n'), sources: [] }));
    expect(parts.length).toBe(2);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4096);
    expect(parts.join('\n\n')).toBe([paragraph, paragraph, paragraph].join('\n\n'));
  });

  it('découpe aussi un bloc sans saut de ligne', () => {
    const parts = splitText('mot '.repeat(2000));
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4096);
  });

  it('rend un formulaire : session + première question, blocs suivants conservés', () => {
    const out = renderAgentMessage(
      msg(
        { type: 'form', id: 'f1', fields: [{ name: 'nom', label: 'Votre nom ?', required: true, type: 'text' }] },
        { type: 'text', text: 'Merci', sources: [] },
      ),
      ctx,
    );
    expect(out.formSession).toMatchObject({ formId: 'f1', index: 0, values: {}, startedAt: ctx.now.getTime() });
    expect(bodies(msg({ type: 'form', id: 'f1', fields: [{ name: 'nom', label: 'Votre nom ?', required: true, type: 'text' }] }, { type: 'text', text: 'Merci', sources: [] }))).toEqual(['Votre nom ?', 'Merci']);
  });

  it('rend une demande de pièce avec les formats acceptés', () => {
    const [body] = bodies(
      msg({
        type: 'fileRequest',
        documentType: 'id',
        label: 'Votre acte de naissance',
        acceptedMimeTypes: ['application/pdf', 'image/jpeg', 'image/webp', 'audio/ogg'],
      }),
    );
    expect(body).toBe(
      'Votre acte de naissance\nEnvoyez la pièce dans cette conversation : PDF, photo JPEG, message vocal, 10 Mo maximum.',
    );
  });

  it('demande de pièce sans format reconnu : liste complète du contrat', () => {
    const [body] = bodies(msg({ type: 'fileRequest', documentType: 'id', label: 'Pièce', acceptedMimeTypes: [] }));
    expect(body).toContain('PDF, photo JPEG, photo PNG, message vocal');
  });

  it('rend une carte de statut, lien officiel seulement si http(s)', () => {
    expect(bodies(msg({ type: 'statusCard', request: request() }))).toEqual([
      'Votre demande : À valider sur le portail officiel\nDémarche : demo-procedure\nMise à jour le 22/10/2026\nPortail officiel : https://example.org/portail',
    ]);
    const [noLink] = bodies(msg({ type: 'statusCard', request: request({ officialLink: 'javascript:x', status: 'draft' }) }));
    expect(noLink).toBe('Votre demande : Brouillon\nDémarche : demo-procedure\nMise à jour le 22/10/2026');
    expect(bodies(msg({ type: 'statusCard', request: request({ officialLink: null }) }))[0]).not.toContain('Portail');
  });

  it('libellés de statut', () => {
    const expected: Record<RequestStatus, string> = {
      draft: 'Brouillon',
      ready: 'Prête',
      awaiting_user_validation: 'À valider sur le portail officiel',
      submitted: 'Déposée',
      processing: 'En traitement',
      completed: 'Terminée',
      rejected: 'Rejetée',
      cancelled: 'Annulée',
    };
    expect(STATUS_LABELS).toEqual(expected);
  });

  it('échoue sur un type de bloc inconnu (vérification never)', () => {
    const bad = msg({ type: 'hologram' } as unknown as Block);
    expect(() => renderAgentMessage(bad, ctx)).toThrow(/Type de bloc non géré/);
  });

  it('est déterministe', () => {
    const m = msg({ type: 'text', text: 'Bonjour', sources: [source] }, { type: 'buttons', items: [{ id: 'a', label: 'Oui' }] });
    expect(renderAgentMessage(m, ctx)).toEqual(renderAgentMessage(m, ctx));
  });
});
