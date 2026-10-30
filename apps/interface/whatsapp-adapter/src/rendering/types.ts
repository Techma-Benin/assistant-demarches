import type { FormField } from '../contracts/types.js';

/** Corps Meta sans `to`, `messaging_product` ni `recipient_type` (ajoutés par l’expéditeur). */
export type OutboundMessage =
  | { type: 'text'; text: { body: string; preview_url: false } }
  | {
      type: 'interactive';
      interactive: {
        type: 'button';
        body: { text: string };
        action: { buttons: { type: 'reply'; reply: { id: string; title: string } }[] };
      };
    };

export interface FormSession {
  formId: string;
  fields: FormField[];
  index: number;
  values: Record<string, string>;
  startedAt: number;
}

export interface RenderContext {
  now: Date;
}

export interface RenderResult {
  messages: OutboundMessage[];
  formSession?: FormSession;
  buttonIds?: Record<string, string>;
}
