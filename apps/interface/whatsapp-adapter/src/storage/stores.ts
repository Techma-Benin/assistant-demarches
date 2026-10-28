import type { FormSession } from '../rendering/types.js';

export type DedupeResult = 'new' | 'duplicate' | 'conflict';

/** Déduplication : `conflict` = même clé, empreinte différente. */
export interface DedupeStore {
  check(key: string, digest: string, ttlMs: number): Promise<DedupeResult>;
}

export interface ConversationDirectory {
  getBySubject(subjectKey: string): Promise<string | undefined>;
  getWaIdByConversation(conversationId: string): Promise<string | undefined>;
  /** Production : `waId` doit être chiffré au repos. */
  save(subjectKey: string, waId: string, conversationId: string): Promise<void>;
}

export interface FormSessionStore {
  get(conversationId: string): Promise<FormSession | undefined>;
  set(conversationId: string, session: FormSession): Promise<void>;
  clear(conversationId: string): Promise<void>;
}

/** Associe un identifiant de réponse court (`b_…`) à l’identifiant de bouton d’origine (> 256 caractères). */
export interface ButtonIdMap {
  remember(conversationId: string, mapping: Record<string, string>): Promise<void>;
  /** Retourne l’identifiant d’origine, ou l’identifiant reçu s’il n’a pas été raccourci. */
  resolve(conversationId: string, replyId: string): Promise<string>;
}

export const DEDUPE_TTL_MS = 24 * 3600 * 1000;
export const FORM_SESSION_TTL_MS = 3600 * 1000;
export const BUTTON_MAP_TTL_MS = 24 * 3600 * 1000;
