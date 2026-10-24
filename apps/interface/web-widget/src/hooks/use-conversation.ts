'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { C1Client, C1Error, type MessageInput } from '@/lib/c1-client';
import { conversationReducer, initialState } from '@/lib/conversation-state';
import { CONTRACT_MIME_TYPES, contentTypeFor, validateFile, type ContractMimeType } from '@/lib/files';
import { newId } from '@/lib/ids';
import { buttonInteraction, formInteraction } from '@/lib/interactions';

interface PendingUpload {
  file: File;
  mimeType: ContractMimeType;
  uploadKey: string;
  sentAt: string;
}

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
  // Message id -> file and upload Idempotency-Key, kept so retries reuse both.
  const uploads = useRef(new Map<string, PendingUpload>());

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

  const upload = useCallback(
    async (id: string, entry: PendingUpload) => {
      try {
        const uploaded = await c1.uploadFile(entry.file, entry.mimeType, entry.uploadKey);
        dispatch({ type: 'fileUploadSucceeded', id, file: uploaded });
        if (uploaded.scanStatus === 'rejected') return;
        // Pending files are sent anyway: v1 has no scan-status endpoint, the Backend owns usability
        // (open question in README).
        const input: MessageInput = {
          id,
          content: { type: contentTypeFor(uploaded.mimeType), fileId: uploaded.id },
          sentAt: entry.sentAt,
        };
        pending.current.set(id, input);
        await post(input);
      } catch (error) {
        const status = error instanceof C1Error ? error.status : undefined;
        if (status === 413) {
          dispatch({ type: 'fileUploadFailed', id, error: 'Fichier trop volumineux (10 Mo maximum).', retryable: false });
        } else if (status === 415) {
          dispatch({ type: 'fileUploadFailed', id, error: 'Format non accepté.', retryable: false });
        } else {
          dispatch({ type: 'fileUploadFailed', id, error: 'Échec de l’envoi de la pièce.', retryable: true });
        }
      }
    },
    [c1, post],
  );

  const sendFile = useCallback(
    (file: File) => {
      if (!conversationId) return;
      const validation = validateFile(file, CONTRACT_MIME_TYPES);
      if (!validation.ok) return;
      const id = newId('msg');
      const entry: PendingUpload = {
        file,
        mimeType: validation.mimeType,
        uploadKey: crypto.randomUUID(),
        sentAt: new Date().toISOString(),
      };
      uploads.current.set(id, entry);
      // The file name stays local: it is never sent to the backend.
      dispatch({
        type: 'fileUploadStarted',
        id,
        attachment: { name: file.name, sizeBytes: file.size, mimeType: validation.mimeType },
        sentAt: entry.sentAt,
      });
      void upload(id, entry);
    },
    [conversationId, upload],
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
      const entry = uploads.current.get(entryId);
      if (!input && entry) {
        // Upload step failed: redo it with the same Idempotency-Key.
        const current = state.timeline.find((e) => e.kind === 'user' && e.id === entryId);
        if (current?.kind !== 'user' || current.delivery !== 'uploadFailed' || !current.retryable) return;
        dispatch({
          type: 'fileUploadStarted',
          id: entryId,
          attachment: current.attachment!,
          sentAt: entry.sentAt,
        });
        void upload(entryId, entry);
        return;
      }
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
    [post, upload, state.timeline],
  );

  return { state, sendText, sendButton, sendForm, sendFile, retry };
}
