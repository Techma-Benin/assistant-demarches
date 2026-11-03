import { describe, expect, it } from 'vitest';
import type { ContractFile, MessageInput } from '../src/contracts/types.js';
import { C1Error, type C1Client, type C1Context } from '../src/backend/c1-client.js';
import { DevSubjectTokenProvider } from '../src/backend/subject-token.js';
import { subjectKeyFor } from '../src/common/crypto.js';
import { FakeMetaMedia } from '../src/meta/fakes.js';
import { renderAgentMessage } from '../src/rendering/render.js';
import { startFormSession } from '../src/rendering/form-session.js';
import { InMemoryButtonIdMap, InMemoryConversationDirectory, InMemoryDedupeStore, InMemoryFormSessionStore } from '../src/storage/in-memory.js';
import { InboundProcessor, REPLIES } from '../src/webhook/inbound-processor.js';
import type { InboundItem } from '../src/webhook/inbound-queue.js';
import type { WaMessage } from '../src/webhook/payload.js';
import { RecordingOutboundQueue, WA_ID, TRACEPARENT, textsOf, waText } from './helpers.js';

const HMAC_KEY = 'k'.repeat(40);
const CONVERSATION = 'cnv_0000000000000000000000000A';

class FakeC1 implements C1Client {
  conversations: { key: string; ctx: C1Context }[] = [];
  messages: MessageInput[] = [];
  uploads: { mime: string; size: number; key: string }[] = [];
  scanStatus: ContractFile['scanStatus'] = 'clean';
  failSend: C1Error | undefined;
  async createConversation(ctx: C1Context, _input: { channel: 'whatsapp'; locale: 'fr' }, key: string) {
    this.conversations.push({ key, ctx });
    return { id: CONVERSATION };
  }
  async sendMessage(_ctx: C1Context, _conversationId: string, input: MessageInput) {
    if (this.failSend) throw this.failSend;
    this.messages.push(input);
  }
  async uploadFile(_ctx: C1Context, bytes: Uint8Array, mime: string, key: string): Promise<ContractFile> {
    this.uploads.push({ mime, size: bytes.length, key });
    return { id: 'fil_0000000000000000000000000F', mimeType: mime, sizeBytes: bytes.length, scanStatus: this.scanStatus, expiresAt: '2026-10-26T00:00:00Z' };
  }
}

function setup() {
  const c1 = new FakeC1();
  const outbound = new RecordingOutboundQueue();
  const media = new FakeMetaMedia();
  const forms = new InMemoryFormSessionStore();
  const buttons = new InMemoryButtonIdMap();
  const directory = new InMemoryConversationDirectory();
  const processor = new InboundProcessor(
    new InMemoryDedupeStore(),
    directory,
    forms,
    buttons,
    new DevSubjectTokenProvider('mock-user', 'http://127.0.0.1:4010'),
    c1,
    media,
    outbound,
  );
  const run = (message: WaMessage, attempt = 0) => {
    const item: InboundItem = { subjectKey: subjectKeyFor(HMAC_KEY, message.from), message, traceparent: TRACEPARENT };
    return processor.process(item, attempt);
  };
  const localTexts = async () => (await outbound.targets()).flatMap((t) => textsOf(t));
  return { c1, outbound, media, forms, buttons, directory, processor, run, localTexts };
}

const waMedia = (type: 'image' | 'document' | 'audio', mime: string, id = 'wamid.M1'): WaMessage => ({
  from: WA_ID,
  id,
  timestamp: '1760000000',
  type,
  [type]: { id: 'media-1', mime_type: mime },
});

describe('traitement des messages entrants', () => {
  it('texte : crée la conversation une fois puis transmet un MessageInput déterministe', async () => {
    const t = setup();
    await t.run(waText('Bonjour', 'wamid.A'));
    await t.run(waText('Encore', 'wamid.B'));
    expect(t.c1.conversations).toHaveLength(1);
    expect(t.c1.conversations[0]!.key).toBe(`wa-conv-${subjectKeyFor(HMAC_KEY, WA_ID)}`);
    expect(t.c1.conversations[0]!.ctx).toEqual({ token: 'mock-user', traceparent: TRACEPARENT });
    expect(t.c1.messages).toHaveLength(2);
    const [first] = t.c1.messages;
    expect(first!.id).toMatch(/^msg_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(first!.content).toEqual({ type: 'text', text: 'Bonjour' });
    expect(first!.sentAt).toBe('2025-10-09T08:53:20.000Z');
    expect(await t.directory.getWaIdByConversation(CONVERSATION)).toBe(WA_ID);
  });

  it('le numéro n’est jamais transmis au Backend', async () => {
    const t = setup();
    await t.run(waText('Bonjour'));
    expect(JSON.stringify([t.c1.conversations, t.c1.messages])).not.toContain(WA_ID);
  });

  it('texte : espaces retirés, vide ignoré', async () => {
    const t = setup();
    await t.run(waText('  salut  ', 'wamid.A'));
    await t.run(waText('   ', 'wamid.B'));
    expect(t.c1.messages.map((m) => m.content)).toEqual([{ type: 'text', text: 'salut' }]);
  });

  it('texte de plus de 4000 caractères : réponse locale, rien transmis', async () => {
    const t = setup();
    await t.run(waText('x'.repeat(4001)));
    expect(t.c1.messages).toHaveLength(0);
    expect(await t.localTexts()).toEqual([REPLIES.tooLong]);
    await t.run(waText('x'.repeat(4000), 'wamid.OK'));
    expect(t.c1.messages).toHaveLength(1);
  });

  it('réponse de bouton : identifiant tel quel', async () => {
    const t = setup();
    await t.run({ from: WA_ID, id: 'wamid.BTN', timestamp: '1760000000', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'oui', title: 'Oui' } } });
    expect(t.c1.messages[0]!.content).toEqual({ type: 'interaction', actionId: 'oui' });
  });

  it('réponse de bouton : identifiant long retrouvé via la table de correspondance', async () => {
    const t = setup();
    const longId = 'action:' + 'z'.repeat(300);
    await t.run(waText('Bonjour', 'wamid.INIT'));
    const rendered = renderAgentMessage(
      { id: 'msg_00000000000000000000000001', conversationId: CONVERSATION, createdAt: '2026-10-22T18:00:00Z', blocks: [{ type: 'buttons', items: [{ id: longId, label: 'Valider' }] }] },
      { now: new Date() },
    );
    await t.buttons.remember(CONVERSATION, rendered.buttonIds!);
    const shortId = Object.keys(rendered.buttonIds!)[0]!;
    await t.run({ from: WA_ID, id: 'wamid.BTN2', timestamp: '1760000001', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: shortId, title: 'Valider' } } });
    expect(t.c1.messages.at(-1)!.content).toEqual({ type: 'interaction', actionId: longId });
  });

  it('image : téléchargement, envoi du fichier puis message avec fileId', async () => {
    const t = setup();
    t.media.register('media-1', Buffer.from('jpeg-bytes'));
    await t.run(waMedia('image', 'image/jpeg'));
    expect(t.c1.uploads).toEqual([{ mime: 'image/jpeg', size: 10, key: 'wa-file-wamid.M1' }]);
    expect(t.c1.messages[0]!.content).toEqual({ type: 'image', fileId: 'fil_0000000000000000000000000F' });
  });

  it('note vocale : le MIME est normalisé sans paramètres', async () => {
    const t = setup();
    t.media.register('media-1', Buffer.from('opus'));
    await t.run(waMedia('audio', 'audio/ogg; codecs=opus'));
    expect(t.c1.uploads[0]!.mime).toBe('audio/ogg');
    expect(t.c1.messages[0]!.content).toMatchObject({ type: 'audio' });
  });

  it('document PDF : type file ; clé de dépôt tronquée à 128 caractères', async () => {
    const t = setup();
    t.media.register('media-1', Buffer.from('%PDF'));
    await t.run(waMedia('document', 'application/pdf', 'wamid.' + 'W'.repeat(200)));
    expect(t.c1.uploads[0]!.key).toHaveLength(128);
    expect(t.c1.messages[0]!.content).toMatchObject({ type: 'file' });
  });

  it('MIME non accepté : réponse locale, aucun téléchargement', async () => {
    const t = setup();
    await t.run(waMedia('image', 'image/webp'));
    expect(t.c1.uploads).toHaveLength(0);
    expect(t.c1.messages).toHaveLength(0);
    expect(await t.localTexts()).toEqual([REPLIES.badFormat]);
  });

  it('fichier de plus de 10 485 760 octets : réponse locale', async () => {
    const t = setup();
    t.media.register('media-1', Buffer.alloc(10_485_761));
    await t.run(waMedia('document', 'application/pdf'));
    expect(t.c1.uploads).toHaveLength(0);
    expect(await t.localTexts()).toEqual([REPLIES.tooBig]);
  });

  it('média introuvable chez Meta : réponse locale', async () => {
    const t = setup();
    await t.run(waMedia('image', 'image/png'));
    expect(await t.localTexts()).toEqual([REPLIES.unreadable]);
  });

  it('fichier rejeté par l’analyse : réponse locale, message non transmis', async () => {
    const t = setup();
    t.media.register('media-1', Buffer.from('x'));
    t.c1.scanStatus = 'rejected';
    await t.run(waMedia('image', 'image/png'));
    expect(t.c1.messages).toHaveLength(0);
    expect(await t.localTexts()).toEqual([REPLIES.rejected]);
  });

  it('types non pris en charge : réponse locale', async () => {
    const t = setup();
    for (const [i, type] of ['sticker', 'location', 'video', 'contacts', 'reaction'].entries()) {
      await t.run({ from: WA_ID, id: `wamid.U${i}`, timestamp: '1760000000', type });
    }
    expect(t.c1.messages).toHaveLength(0);
    expect(await t.localTexts()).toEqual(Array(5).fill(REPLIES.unsupported));
  });

  it('wamid dupliqué : ignoré silencieusement ; contenu différent : conflit ignoré', async () => {
    const t = setup();
    await t.run(waText('Bonjour', 'wamid.DUP'));
    await t.run(waText('Bonjour', 'wamid.DUP'));
    await t.run(waText('Autre', 'wamid.DUP'));
    expect(t.c1.messages).toHaveLength(1);
    expect(await t.localTexts()).toEqual([]);
  });

  it('STOP / HISTORIQUE : transmis comme texte normal', async () => {
    const t = setup();
    await t.run(waText(' stop ', 'wamid.S'));
    await t.run(waText('Historique', 'wamid.H'));
    expect(t.c1.messages.map((m) => m.content)).toEqual([
      { type: 'text', text: 'stop' },
      { type: 'text', text: 'Historique' },
    ]);
  });
});

describe('formulaire par échanges successifs', () => {
  const fields = [
    { name: 'nom', label: 'Votre nom ?', required: true, type: 'text' as const },
    { name: 'age', label: 'Votre âge ?', required: true, type: 'number' as const },
  ];

  it('pose les questions puis transmet l’interaction finale, dérivée du dernier wamid', async () => {
    const t = setup();
    await t.run(waText('Bonjour', 'wamid.INIT'));
    await t.forms.set(CONVERSATION, startFormSession('form-1', fields, new Date()));
    await t.run(waText('Awa', 'wamid.F1'));
    await t.run(waText('abc', 'wamid.F2'));
    await t.run(waText('31', 'wamid.F3'));
    expect(await t.localTexts()).toEqual(['Votre âge ?\nRépondez par un nombre.', 'Je n’ai pas compris le nombre. Répondez par un nombre.\nVotre âge ?\nRépondez par un nombre.']);
    const last = t.c1.messages.at(-1)!;
    expect(last.content).toEqual({ type: 'interaction', actionId: 'form-1', value: JSON.stringify({ nom: 'Awa', age: '31' }) });
    expect(t.c1.messages).toHaveLength(2);
    expect(await t.forms.get(CONVERSATION)).toBeUndefined();
    const { deriveMessageId } = await import('../src/common/ids.js');
    expect(last.id).toBe(deriveMessageId('wamid.F3', 1760000000));
  });

  it('STOP interrompt un formulaire en cours', async () => {
    const t = setup();
    await t.run(waText('Bonjour', 'wamid.INIT'));
    await t.forms.set(CONVERSATION, startFormSession('form-1', fields, new Date()));
    await t.run(waText('STOP', 'wamid.STOP'));
    expect(t.c1.messages.at(-1)!.content).toEqual({ type: 'text', text: 'STOP' });
    expect(await t.forms.get(CONVERSATION)).toBeUndefined();
  });
});

describe('erreurs C1', () => {
  it('5xx : erreur retentable, et la reprise ne déduplique pas', async () => {
    const t = setup();
    t.c1.failSend = new C1Error(503);
    await expect(t.run(waText('Bonjour', 'wamid.R'))).rejects.toMatchObject({ retryable: true });
    t.c1.failSend = undefined;
    await t.run(waText('Bonjour', 'wamid.R'), 1);
    expect(t.c1.messages).toHaveLength(1);
  });

  it('4xx : journalisé et abandonné sans erreur', async () => {
    const t = setup();
    t.c1.failSend = new C1Error(400);
    await expect(t.run(waText('Bonjour', 'wamid.X'))).resolves.toBeUndefined();
  });

  it('erreur réseau : retentable', async () => {
    expect(new C1Error(0).retryable).toBe(true);
    expect(new C1Error(429).retryable).toBe(true);
    expect(new C1Error(404).retryable).toBe(false);
  });
});
