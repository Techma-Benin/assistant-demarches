import { Inject, Injectable } from '@nestjs/common';
import type { ContractEvent } from '../contracts/types.js';
import { line, loggerFor } from '../common/log.js';
import type { OutboundQueue } from '../meta/outbound-queue.js';
import { renderAgentMessage } from '../rendering/render.js';
import type { ButtonIdMap, ConversationDirectory, FormSessionStore } from '../storage/stores.js';
import { BUTTON_ID_MAP, CONVERSATION_DIRECTORY, FORM_SESSION_STORE, OUTBOUND_QUEUE } from '../tokens.js';
import type { AgentMessage } from '../contracts/types.js';

export interface OutboundDispatcher {
  dispatch(event: ContractEvent): void;
}

/** Transforme un événement `message.sent` en tâche d’envoi ordonnée par conversation. */
@Injectable()
export class DefaultOutboundDispatcher implements OutboundDispatcher {
  private readonly logger = loggerFor('OutboundDispatcher');

  constructor(
    @Inject(OUTBOUND_QUEUE) private readonly queue: OutboundQueue,
    @Inject(CONVERSATION_DIRECTORY) private readonly directory: ConversationDirectory,
    @Inject(FORM_SESSION_STORE) private readonly forms: FormSessionStore,
    @Inject(BUTTON_ID_MAP) private readonly buttons: ButtonIdMap,
  ) {}

  dispatch(event: ContractEvent): void {
    const conversationId = event.data.conversationId as string;
    const message = event.data.message as AgentMessage;
    this.queue.enqueue({
      key: conversationId,
      ref: event.id,
      prepare: async () => {
        const waId = await this.directory.getWaIdByConversation(conversationId);
        if (!waId) {
          // Conversation inconnue de cet adaptateur : pas de nouvelle tentative.
          this.logger.warn(line('outbound.unknown_conversation', { eventId: event.id, conversationId }));
          return null;
        }
        const rendered = renderAgentMessage(message, { now: new Date() });
        if (rendered.formSession) await this.forms.set(conversationId, rendered.formSession);
        if (rendered.buttonIds) await this.buttons.remember(conversationId, rendered.buttonIds);
        return { to: waId, messages: rendered.messages };
      },
    });
  }
}
