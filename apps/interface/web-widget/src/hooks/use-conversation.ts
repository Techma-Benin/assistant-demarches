'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { C1Client, C1Error, type MessageInput } from '@/lib/c1-client';
import { conversationReducer, initialState } from '@/lib/conversation-state';
import { newId } from '@/lib/ids';
import { buttonInteraction, formInteraction } from '@/lib/interactions';

const MAX_TEXT_LENGTH = 4000;
const POLL_INTERVAL_MS = 1000;
const PAGE_SIZE = 100;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

export function useConversation(client?: C1Client) {
  const c1 = useMemo(() => client ?? new C1Client(), [client]);
  const [state, dispatch] = useReducer(conversationReducer, initialState);
  // Stable across StrictMode's double effect: the second create hits the same idempotent result.
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const pending = useRef(new Map<string, MessageInput>());

  useEffect(() => {
    let cancelled = false;
    c1.createConversation({ channel: 'web', locale: 'fr' }, idempotencyKey.current)
      .then((conversation) => {
        if (!cancelled) dispatch({ type: 'conversationStarted', conversationId: conversation.id });
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({ type: 'startFailed', error: 'Impossible de démarrer la conversation. Veuillez réessayer.' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [c1]);

  // Polling fallback (CONTRACTS.md §5). TODO: WebSocket (socket-ticket) in a later task.
  const conversationId = state.conversationId;
  useEffect(() => {
    if (!conversationId) return;
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      let cursor: string | null = null;
      while (!signal.aborted) {
        let delay = POLL_INTERVAL_MS;
        try {
          const page = await c1.listEvents(conversationId, cursor, signal);
          if (signal.aborted) return;
          dispatch({ type: 'eventsReceived', page });
          cursor = page.nextCursor ?? cursor;
          if (page.items.length === PAGE_SIZE) delay = 0;
        } catch (error) {
          if (signal.aborted) return;
          if (error instanceof C1Error && error.status === 410) {
            cursor = null;
            dispatch({ type: 'replayExpired' });
            delay = 0;
          } else if (error instanceof C1Error && (error.status === 429 || error.status === 503)) {
            delay = (error.retryAfterSeconds ?? 1) * 1000;
          }
        }
        if (delay > 0) await sleep(delay, signal);
      }
    })();
    return () => controller.abort();
  }, [c1, conversationId]);

  const post = useCallback(
    async (input: MessageInput) => {
      if (!conversationId) return;
      try {
        await c1.sendMessage(conversationId, input);
        dispatch({ type: 'userMessageAccepted', id: input.id });
      } catch {
        dispatch({ type: 'userMessageFailed', id: input.id });
      }
    },
    [c1, conversationId],
  );

  const enqueue = useCallback(
    (content: MessageInput['content'], display: string) => {
      if (!conversationId) return;
      const input: MessageInput = { id: newId('msg'), content, sentAt: new Date().toISOString() };
      pending.current.set(input.id, input);
      dispatch({ type: 'userMessageQueued', id: input.id, content, display, sentAt: input.sentAt });
      void post(input);
    },
    [conversationId, post],
  );

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) return;
      enqueue({ type: 'text', text: trimmed }, trimmed);
    },
    [enqueue],
  );

  const sendButton = useCallback(
    (item: { id: string; label: string }) => enqueue(buttonInteraction(item), item.label),
    [enqueue],
  );

  const sendForm = useCallback(
    (formId: string, values: Record<string, string>, displaySummary: string) =>
      enqueue(formInteraction(formId, values), displaySummary),
    [enqueue],
  );

  const retry = useCallback(
    (entryId: string) => {
      const input = pending.current.get(entryId);
      if (!input) return;
      // Same MessageInput => same id => same Idempotency-Key.
      dispatch({
        type: 'userMessageQueued',
        id: input.id,
        content: input.content,
        display: '',
        sentAt: input.sentAt,
      });
      void post(input);
    },
    [post],
  );

  return { state, sendText, sendButton, sendForm, retry };
}
