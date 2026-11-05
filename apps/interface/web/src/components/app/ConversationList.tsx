'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, InlineAlert, TypingIndicator } from '@techma/ui';
import { formatDateFr } from '@/lib/cases';
import { C1Client, type Conversation, type ConversationEvent } from '@/lib/c1-client';
import { saveConversation } from '@/lib/conversation-persistence';
import { formatRelative, formatTime } from '@/lib/format-time';

const PAGE_SIZE = 10;
const MAX_TITLE_REQUESTS = 3;
const TITLE_LENGTH = 80;

/** The contract has no title: the first thing the person sent stands for it. */
function titleFromEvents(events: ConversationEvent[]): string | null {
  for (const event of events) {
    if (event.data.kind !== 'message.received') continue;
    const content = event.data.message.content;
    if (content.type === 'audio') return 'Message vocal';
    if (content.type === 'file') return 'Pièce jointe';
    if (content.type === 'text') {
      const text = content.text.trim();
      if (text === '') continue;
      return text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : text;
    }
  }
  return null;
}

function fallbackTitle(item: Conversation): string {
  const time = formatTime(item.createdAt);
  return `Conversation du ${formatDateFr(item.createdAt)}${time && ` à ${time}`}`;
}

function resume(item: Conversation) {
  saveConversation({ conversationId: item.id });
  window.location.assign('/conversation');
}

/** The person's conversations, newest first (`GET /v1/conversations`); « Reprendre » reopens one in this tab. */
export function ConversationList({ client }: { client?: C1Client }) {
  const [c1] = useState(() => client ?? new C1Client());
  const [items, setItems] = useState<Conversation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [titles, setTitles] = useState<Record<string, string>>({});
  // Conversations whose history holds no message: hidden once known (`lastMessageAt` alone is not reliable).
  const [empty, setEmpty] = useState<Set<string>>(() => new Set());
  const started = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const requested = useRef(new Set<string>());
  const queue = useRef<string[]>([]);
  const inFlight = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    return () => controller.abort();
  }, []);

  // At most MAX_TITLE_REQUESTS history reads at a time: a failed one keeps the date title.
  const pump = useCallback(() => {
    while (inFlight.current < MAX_TITLE_REQUESTS && queue.current.length > 0) {
      const id = queue.current.shift()!;
      const signal = abort.current?.signal;
      if (signal?.aborted) return;
      inFlight.current += 1;
      c1.listEvents(id, null, signal)
        .then((page) => {
          if (signal?.aborted) return;
          if (!page.items.some((event) => event.data.kind === 'message.received')) {
            setEmpty((all) => new Set(all).add(id));
            return;
          }
          const title = titleFromEvents(page.items);
          if (title !== null) setTitles((all) => ({ ...all, [id]: title }));
        })
        .catch(() => {})
        .finally(() => {
          inFlight.current -= 1;
          pump();
        });
    }
  }, [c1]);

  const load = useCallback(
    async (from: string | null) => {
      setState('loading');
      try {
        const page = await c1.listConversations(from, PAGE_SIZE);
        const visible = page.items;
        setItems((all) => (from ? [...all, ...visible] : visible));
        setCursor(page.nextCursor);
        setState('idle');
        for (const item of visible) {
          if (requested.current.has(item.id)) continue;
          requested.current.add(item.id);
          queue.current.push(item.id);
        }
        pump();
      } catch {
        setState('error');
      }
    },
    [c1, pump],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load(null);
  }, [load]);

  if (state === 'error' && items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <InlineAlert>Impossible de charger vos conversations pour le moment.</InlineAlert>
        <Button variant="secondary" onClick={() => void load(null)}>
          Réessayer
        </Button>
      </div>
    );
  }
  if (state === 'loading' && items.length === 0) {
    return (
      <div className="flex items-center gap-2 text-ink-muted">
        <TypingIndicator label="Chargement de vos conversations…" />
        <span aria-hidden="true">Chargement de vos conversations…</span>
      </div>
    );
  }
  const shown = items.filter((item) => !empty.has(item.id));
  if (shown.length === 0 && cursor === null) {
    return <p className="m-0 text-[17px] text-ink-muted">Aucune conversation pour le moment.</p>;
  }
  return (
    <>
      <ul aria-label="Vos conversations" className="m-0 flex list-none flex-col gap-4 p-0">
        {shown.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-[24px] border border-line bg-surface p-5 md:p-6">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="m-0 break-words font-display text-[20px] font-extrabold leading-[1.2] tracking-[-0.02em]">
                {titles[item.id] ?? fallbackTitle(item)}
              </p>
              <p className="m-0 text-[14px] text-ink-muted">
                {item.lastMessageAt ? `Dernier message ${formatRelative(item.lastMessageAt)}` : `Commencée ${formatRelative(item.createdAt)}`}
              </p>
            </div>
            <Button variant="secondary" onClick={() => resume(item)}>
              Reprendre
            </Button>
          </li>
        ))}
      </ul>
      {state === 'error' && <InlineAlert>Impossible de charger la suite.</InlineAlert>}
      {cursor !== null && (
        <Button variant="secondary" className="self-start" disabled={state === 'loading'} onClick={() => void load(cursor)}>
          {state === 'loading' ? 'Chargement…' : 'Voir plus'}
        </Button>
      )}
    </>
  );
}
