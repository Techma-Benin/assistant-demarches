import { Inject, Injectable } from '@nestjs/common';
import { CONTRACT_MIME_TYPES, MAX_FILE_BYTES, type Content } from '../contracts/types.js';
import { C1Error, type C1Client, type C1Context } from '../backend/c1-client.js';
import type { SubjectTokenProvider } from '../backend/subject-token.js';
import { sha256Hex } from '../common/crypto.js';
import { describeError, isRetryable } from '../common/errors.js';
import { deriveMessageId } from '../common/ids.js';
import { line, loggerFor } from '../common/log.js';
import { MediaTooLargeError, MetaPermanentError, type MetaMedia } from '../meta/meta.js';
import { staticJob, type OutboundQueue } from '../meta/outbound-queue.js';
import { advanceForm } from '../rendering/form-session.js';
import { textMessage } from '../rendering/text.js';
import type { ButtonIdMap, ConversationDirectory, DedupeStore, FormSessionStore } from '../storage/stores.js';
import { DEDUPE_TTL_MS } from '../storage/stores.js';
import {
  BUTTON_ID_MAP,
  C1_CLIENT,
  CONVERSATION_DIRECTORY,
  DEDUPE_STORE,
  FORM_SESSION_STORE,
  META_MEDIA,
  OUTBOUND_QUEUE,
  SUBJECT_TOKEN_PROVIDER,
} from '../tokens.js';
import type { InboundHandler, InboundItem } from './inbound-queue.js';
import type { WaMedia, WaMessage } from './payload.js';

export const TEXT_MAX_CHARS = 4000;

export const REPLIES = {
  tooLong: 'Votre message est trop long (4 000 caractères maximum).',
  badFormat: 'Ce format n’est pas accepté. Envoyez une photo (JPEG, PNG), un PDF ou un message vocal.',
  tooBig: 'Ce fichier est trop volumineux (10 Mo maximum).',
  rejected: 'Ce fichier a été refusé par l’analyse de sécurité.',
  unsupported: 'Ce type de message n’est pas pris en charge. Envoyez du texte, une photo ou un PDF.',
  unreadable: 'Je n’ai pas pu récupérer votre fichier. Pouvez-vous l’envoyer à nouveau ?',
} as const;

const KEYWORDS = new Set(['stop', 'historique']);

/** `audio/ogg; codecs=opus` -> `audio/ogg`. */
export const normalizeMime = (mime: string | undefined): string => (mime ?? '').split(';')[0]!.trim().toLowerCase();

@Injectable()
export class InboundProcessor implements InboundHandler {
  private readonly logger = loggerFor('InboundProcessor');

  constructor(
    @Inject(DEDUPE_STORE) private readonly dedupe: DedupeStore,
    @Inject(CONVERSATION_DIRECTORY) private readonly directory: ConversationDirectory,
    @Inject(FORM_SESSION_STORE) private readonly forms: FormSessionStore,
    @Inject(BUTTON_ID_MAP) private readonly buttons: ButtonIdMap,
    @Inject(SUBJECT_TOKEN_PROVIDER) private readonly tokens: SubjectTokenProvider,
    @Inject(C1_CLIENT) private readonly c1: C1Client,
    @Inject(META_MEDIA) private readonly media: MetaMedia,
    @Inject(OUTBOUND_QUEUE) private readonly outbound: OutboundQueue,
  ) {}

  async process(item: InboundItem, attempt: number): Promise<void> {
    const { message, subjectKey } = item;
    // Seule la première tentative déduplique : une reprise après erreur retentable doit repasser.
    if (attempt === 0) {
      const result = await this.dedupe.check(`wamid:${message.id}`, sha256Hex(JSON.stringify(message)), DEDUPE_TTL_MS);
      if (result === 'duplicate') return;
      if (result === 'conflict') {
        this.logger.warn(line('inbound.dedupe_conflict', { subjectKey, wamid: message.id }));
        return;
      }
    }
    try {
      await this.handle(item);
    } catch (error) {
      if (error instanceof C1Error && !error.retryable) {
        this.logger.warn(
          line('inbound.dropped', { subjectKey, wamid: message.id, status: error.status, code: error.code }),
        );
        return;
      }
      throw error;
    }
  }

  private async handle({ message, subjectKey, traceparent }: InboundItem): Promise<void> {
    const waId = message.from;
    const ctx: C1Context = { token: await this.tokens.tokenFor(waId), traceparent };
    const conversationId = await this.ensureConversation(ctx, subjectKey, waId);

    const parsed = Number(message.timestamp);
    const seconds = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : Math.floor(Date.now() / 1000);
    const messageId = deriveMessageId(message.id, seconds);
    const sentAt = new Date(seconds * 1000).toISOString();

    const reply = (text: string) =>
      this.outbound.enqueue(staticJob(conversationId, message.id, waId, [textMessage(text)]));
    const forward = async (content: Content) => {
      await this.c1.sendMessage(ctx, conversationId, { id: messageId, content, sentAt });
      this.logger.log(line('inbound.forwarded', { subjectKey, wamid: message.id, conversationId, kind: content.type }));
    };

    switch (message.type) {
      case 'text':
        return this.handleText(message, conversationId, waId, reply, forward);
      case 'interactive': {
        const replyId = message.interactive?.type === 'button_reply' ? message.interactive.button_reply?.id : undefined;
        if (!replyId) return reply(REPLIES.unsupported);
        const actionId = await this.buttons.resolve(conversationId, replyId);
        return forward({ type: 'interaction', actionId });
      }
      case 'image':
      case 'document':
      case 'audio':
        return this.handleMedia(message, message.type, ctx, reply, forward);
      default:
        // sticker, location, video, contacts, reaction…
        return reply(REPLIES.unsupported);
    }
  }

  private async ensureConversation(ctx: C1Context, subjectKey: string, waId: string): Promise<string> {
    const known = await this.directory.getBySubject(subjectKey);
    if (known) return known;
    const created = await this.c1.createConversation(ctx, { channel: 'whatsapp', locale: 'fr' }, `wa-conv-${subjectKey}`);
    await this.directory.save(subjectKey, waId, created.id);
    return created.id;
  }

  private async handleText(
    message: WaMessage,
    conversationId: string,
    waId: string,
    reply: (text: string) => void,
    forward: (content: Content) => Promise<void>,
  ): Promise<void> {
    const text = (message.text?.body ?? '').trim();
    if (!text) return;

    // TODO(mandat/historique) : STOP (révocation) et HISTORIQUE nécessitent l’identifiant du mandat
    // et l’historique de l’usager, que le contrat actuel ne livre pas à l’adaptateur (voir README,
    // questions ouvertes). Pour l’instant ils sont transmis comme texte normal. Ils interrompent
    // un formulaire en cours pour ne pas être pris pour une réponse.
    if (KEYWORDS.has(text.toLowerCase())) {
      await this.forms.clear(conversationId);
      return forward({ type: 'text', text });
    }

    const session = await this.forms.get(conversationId);
    if (session) {
      const step = advanceForm(session, text);
      if (step.kind === 'complete') {
        try {
          await forward(step.content);
        } catch (error) {
          if (!isRetryable(error)) await this.forms.clear(conversationId);
          throw error;
        }
        await this.forms.clear(conversationId);
        return;
      }
      await this.forms.set(conversationId, step.session);
      this.outbound.enqueue(staticJob(conversationId, message.id, waId, [step.reply]));
      return;
    }

    if (text.length > TEXT_MAX_CHARS) return reply(REPLIES.tooLong);
    return forward({ type: 'text', text });
  }

  private async handleMedia(
    message: WaMessage,
    kind: 'image' | 'document' | 'audio',
    ctx: C1Context,
    reply: (text: string) => void,
    forward: (content: Content) => Promise<void>,
  ): Promise<void> {
    const media: WaMedia | undefined = message[kind];
    if (!media?.id) return reply(REPLIES.unsupported);
    const mime = normalizeMime(media.mime_type);
    if (!(CONTRACT_MIME_TYPES as readonly string[]).includes(mime)) return reply(REPLIES.badFormat);

    let bytes: Buffer;
    try {
      bytes = await this.media.download(media.id);
    } catch (error) {
      if (error instanceof MediaTooLargeError) return reply(REPLIES.tooBig);
      if (error instanceof MetaPermanentError) {
        this.logger.warn(line('inbound.media_unavailable', { wamid: message.id, error: describeError(error) }));
        return reply(REPLIES.unreadable);
      }
      throw error;
    }
    if (bytes.length > MAX_FILE_BYTES) return reply(REPLIES.tooBig);
    if (bytes.length === 0) return reply(REPLIES.unreadable);

    const file = await this.c1.uploadFile(ctx, bytes, mime, `wa-file-${message.id}`.slice(0, 128));
    if (file.scanStatus === 'rejected') return reply(REPLIES.rejected);
    return forward({ type: kind === 'document' ? 'file' : kind, fileId: file.id });
  }
}
