import type { Content, FormField } from '../contracts/types.js';
import type { FormSession, OutboundMessage } from './types.js';
import { textMessage } from './text.js';

const SKIP_WORD = 'passer';
const TEXT_ANSWER_MAX = 500;

export function questionText(field: FormField): string {
  const optional = field.required ? '' : ' (facultatif : répondez « passer » pour ignorer)';
  const hint =
    field.type === 'number'
      ? '\nRépondez par un nombre.'
      : field.type === 'date'
        ? '\nRépondez au format JJ/MM/AAAA.'
        : '';
  return `${field.label}${optional}${hint}`;
}

export const questionMessage = (field: FormField): OutboundMessage => textMessage(questionText(field));

export function startFormSession(formId: string, fields: FormField[], now: Date): FormSession {
  return { formId, fields, index: 0, values: {}, startedAt: now.getTime() };
}

type Validation = { ok: true; value: string } | { ok: false; error: string };

function validateAnswer(field: FormField, answer: string): Validation {
  switch (field.type) {
    case 'text':
      if (answer === '') return { ok: false, error: 'Je n’ai pas compris votre réponse. Merci d’écrire quelques mots.' };
      if (answer.length > TEXT_ANSWER_MAX)
        return { ok: false, error: `Votre réponse est trop longue (${TEXT_ANSWER_MAX} caractères maximum).` };
      return { ok: true, value: answer };
    case 'number':
      if (!/^-?\d+([.,]\d+)?$/.test(answer))
        return { ok: false, error: 'Je n’ai pas compris le nombre. Répondez par un nombre.' };
      return { ok: true, value: answer.replace(',', '.') };
    case 'date': {
      const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(answer);
      const invalid: Validation = { ok: false, error: 'Je n’ai pas compris la date. Répondez au format JJ/MM/AAAA.' };
      if (!match) return invalid;
      const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return invalid;
      return { ok: true, value: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
    }
  }
}

export type FormStep =
  | { kind: 'reask'; session: FormSession; reply: OutboundMessage }
  | { kind: 'next'; session: FormSession; reply: OutboundMessage }
  | { kind: 'complete'; values: Record<string, string>; content: Extract<Content, { type: 'interaction' }> };

/** Machine d’état pure : n’altère pas la session reçue. */
export function advanceForm(session: FormSession, rawAnswer: string): FormStep {
  const field = session.fields[session.index];
  if (!field) throw new Error('Session de formulaire sans question en cours');
  const answer = rawAnswer.trim();

  let value: string;
  if (!field.required && answer.toLowerCase() === SKIP_WORD) {
    value = '';
  } else {
    const result = validateAnswer(field, answer);
    if (!result.ok) {
      return { kind: 'reask', session, reply: textMessage(`${result.error}\n${questionText(field)}`) };
    }
    value = result.value;
  }

  const values = { ...session.values, [field.name]: value };
  const index = session.index + 1;
  const next = session.fields[index];
  if (!next) {
    // Encodage provisoire, identique au widget web : en attente de confirmation du Backend (voir README du web-widget).
    return { kind: 'complete', values, content: { type: 'interaction', actionId: session.formId, value: JSON.stringify(values) } };
  }
  return { kind: 'next', session: { ...session, index, values }, reply: questionMessage(next) };
}
