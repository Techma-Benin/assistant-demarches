'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  c3,
  type AdminConversation,
  type AuditEntry,
  type Metrics,
  type ModelConfig,
  type Procedure,
  type ToolConfig,
} from './c3-client';

const PAGE_LIMIT = 100;

export const CAPS = { conversations: 500, audit: 500, procedures: 200, tools: 200, models: 200 } as const;

type ListFn<T> = (params: { cursor: string | null; limit: number }) => Promise<{ items: T[]; nextCursor: string | null }>;

/** Follows `nextCursor` until exhausted or `cap` items are loaded (`partial` when the cap stopped it). */
export async function collectAll<T>(listFn: ListFn<T>, cap: number): Promise<{ items: T[]; partial: boolean }> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: T[]; nextCursor: string | null } = await listFn({ cursor, limit: PAGE_LIMIT });
    items.push(...page.items);
    cursor = page.nextCursor;
    if (items.length >= cap && cursor !== null) return { items: items.slice(0, cap), partial: true };
  } while (cursor !== null);
  return { items: items.length > cap ? items.slice(0, cap) : items, partial: items.length > cap };
}

export interface DayCount {
  /** Local calendar day, YYYY-MM-DD. */
  key: string;
  /** Local midnight of that day. */
  date: Date;
  count: number;
}

const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Counts per local calendar day over the last `days` days ending today, oldest first, zero-filled. */
export function conversationsByDay(
  conversations: ReadonlyArray<Pick<AdminConversation, 'createdAt'>>,
  days = 14,
  now: Date = new Date(),
): DayCount[] {
  const result: DayCount[] = [];
  const index = new Map<string, DayCount>();
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const entry = { key: dayKey(date), date, count: 0 };
    result.push(entry);
    index.set(entry.key, entry);
  }
  for (const conversation of conversations) {
    const created = new Date(conversation.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const entry = index.get(dayKey(created));
    if (entry) entry.count += 1;
  }
  return result;
}

export const CHANNELS = ['web', 'whatsapp', 'mobile'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Counts for web, whatsapp, mobile in that fixed order (zeros kept). */
export function conversationsByChannel(
  conversations: ReadonlyArray<Pick<AdminConversation, 'channel'>>,
): { channel: Channel; count: number }[] {
  return CHANNELS.map((channel) => ({
    channel,
    count: conversations.filter((conversation) => conversation.channel === channel).length,
  }));
}

export interface PendingItems {
  draftProcedures: { id: string; title: string }[];
  disabledTools: { name: string }[];
  noActiveModel: boolean;
}

export function pendingItems(
  procedures: ReadonlyArray<Procedure>,
  tools: ReadonlyArray<ToolConfig>,
  models: ReadonlyArray<ModelConfig>,
): PendingItems {
  return {
    draftProcedures: procedures
      .filter((procedure) => procedure.validationStatus === 'draft')
      .map(({ id, title }) => ({ id, title })),
    disabledTools: tools.filter((tool) => !tool.enabled).map(({ name }) => ({ name })),
    noActiveModel: !models.some((model) => model.active),
  };
}

const newestFirst = <T>(items: ReadonlyArray<T>, at: (item: T) => string, count: number): T[] =>
  [...items].sort((a, b) => Date.parse(at(b)) - Date.parse(at(a))).slice(0, count);

export const recentAudit = (entries: ReadonlyArray<AuditEntry>, count = 5): AuditEntry[] =>
  newestFirst(entries, (entry) => entry.at, count);

export const recentConversations = (conversations: ReadonlyArray<AdminConversation>, count = 5): AdminConversation[] =>
  newestFirst(conversations, (conversation) => conversation.createdAt, count);

export type Section<T> =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; data: T };

export interface Collection<T> {
  items: T[];
  partial: boolean;
}

export interface DashboardData {
  metrics: Section<Metrics>;
  conversations: Section<Collection<AdminConversation>>;
  audit: Section<Collection<AuditEntry>>;
  procedures: Section<Collection<Procedure>>;
  tools: Section<Collection<ToolConfig>>;
  models: Section<Collection<ModelConfig>>;
  retry: (key: keyof Omit<DashboardData, 'retry'>) => void;
}

function useSection<T>(load: () => Promise<T>): [Section<T>, () => void] {
  const [section, setSection] = useState<Section<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setSection({ status: 'loading' });
    loadRef.current().then(
      (data) => !cancelled && setSection({ status: 'ready', data }),
      (error: unknown) => !cancelled && setSection({ status: 'error', error }),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return [section, useCallback(() => setAttempt((value) => value + 1), [])];
}

const loadConversations = () => collectAll((params) => c3.listConversations(params), CAPS.conversations);
const loadAudit = () => collectAll((params) => c3.listAudit(params), CAPS.audit);
const loadProcedures = () => collectAll((params) => c3.listProcedures(params), CAPS.procedures);
const loadTools = () => collectAll((params) => c3.listTools(params), CAPS.tools);
const loadModels = () => collectAll((params) => c3.listModels(params), CAPS.models);

/** Loads metrics and the five collections in parallel; each section fails and retries on its own. */
export function useDashboardData(loadMetrics: () => Promise<Metrics> = () => c3.getMetrics()): DashboardData {
  const [metrics, retryMetrics] = useSection(loadMetrics);
  const [conversations, retryConversations] = useSection(loadConversations);
  const [audit, retryAudit] = useSection(loadAudit);
  const [procedures, retryProcedures] = useSection(loadProcedures);
  const [tools, retryTools] = useSection(loadTools);
  const [models, retryModels] = useSection(loadModels);
  const retries = {
    metrics: retryMetrics,
    conversations: retryConversations,
    audit: retryAudit,
    procedures: retryProcedures,
    tools: retryTools,
    models: retryModels,
  };
  const retry = (key: keyof typeof retries) => retries[key]();
  return { metrics, conversations, audit, procedures, tools, models, retry };
}
