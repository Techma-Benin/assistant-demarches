'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { C1Client, C1Error, type MessageInput } from '@/lib/c1-client';
import { ConversationStream, type StreamStatus } from '@/lib/conversation-stream';
import type { Challenge, ConsentControls, ConsentState } from '@/lib/consent';
import { conversationReducer, initialState, type ConversationState } from '@/lib/conversation-state';
import { saveConversation, type ConversationSnapshot } from '@/lib/conversation-persistence';
import { CONTRACT_MIME_TYPES, validateFile, type ContractMimeType } from '@/lib/files';
import { newId } from '@/lib/ids';
import { buttonInteraction, fileContent, formInteraction } from '@/lib/interactions';

interface PendingUpload {
  file: File;
  documentType: string | null;
  mimeType: ContractMimeType;
  uploadKey: string;
  sentAt: string;
}

const MAX_TEXT_LENGTH = 4000;

/** A saved conversation holds only its id: the timeline is rebuilt from the event history. */
function stateFromSnapshot(snapshot: ConversationSnapshot | null | undefined): ConversationState {
  if (!snapshot) return initialState;
  return { ...initialState, conversationId: snapshot.conversationId, status: 'ready' };
}

/** `restored`: a conversation saved before a reload; it is resumed instead of creating a new one. */
export function useConversation(client?: C1Client, restored?: ConversationSnapshot | null) {
  const c1 = useMemo(() => client ?? new C1Client(), [client]);
  const [state, dispatch] = useReducer(conversationReducer, restored, stateFromSnapshot);
  const resumed = useRef(restored ?? null);
  // Stable across StrictMode's double effect: the second create hits the same idempotent result.
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const pending = useRef(new Map<string, MessageInput>());
  // Message id -> file and upload Idempotency-Key, kept so retries reuse both.
  const uploads = useRef(new Map<string, PendingUpload>());
  // Ordered chain of one send (file 1, file 2, ..., note): a message carries ONE file or text, and message POSTs go out in order.
  const nextOf = useRef(new Map<string, string>()); // message id -> id of the following message
  const prevOf = useRef(new Map<string, string>()); // message id -> id of the preceding message
  const held = useRef(new Map<string, MessageInput>()); // ready to post, waiting for the preceding message to be accepted
  const accepted = useRef(new Set<string>());
  const previewUrls = useRef<string[]>([]); // blob URLs of image thumbnails, revoked on unmount

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.length = 0;
    };
  }, []);

  // The conversation is created with the visitor's first message, never on page load. One call at a time:
  // every send waits for this promise, so a first message plus uploads never open several guest sessions.
  const conversationRef = useRef<string | null>(restored?.conversationId ?? null);
  const starting = useRef<Promise<string | null> | null>(null);
  const ensureConversation = useCallback((): Promise<string | null> => {
    if (conversationRef.current) return Promise.resolve(conversationRef.current);
    if (!starting.current) {
      dispatch({ type: 'conversationStarting' });
      starting.current = c1
        .createConversation({ locale: 'fr' }, idempotencyKey.current)
        .then((conversation) => {
          conversationRef.current = conversation.id;
          dispatch({ type: 'conversationStarted', conversationId: conversation.id });
          return conversation.id;
        })
        .catch(() => {
          starting.current = null;
          dispatch({ type: 'startFailed' });
          return null;
        });
    }
    return starting.current;
  }, [c1]);

  // Realtime (CONTRACTS.md §5): WebSocket with polling fallback, owned by ConversationStream.
  const conversationId = state.conversationId;
  const [connection, setConnection] = useState<StreamStatus>('connecting');
  // A resumed conversation shows nothing until its history is back.
  const [loadingHistory, setLoadingHistory] = useState(restored != null);
  useEffect(() => {
    if (!conversationId) return;
    const resuming = resumed.current?.conversationId === conversationId;
    const stream = new ConversationStream({
      client: c1,
      conversationId,
      // Reload: no cursor, the whole history (the user's messages and voice transcripts included) rebuilds the timeline.
      restoreHistory: resuming,
      onHistoryLoaded: () => setLoadingHistory(false),
      onEvents: (items) =>
        dispatch({ type: 'eventsReceived', page: { items, nextCursor: items[items.length - 1].id } }),
      onReplayExpired: () => dispatch({ type: 'replayExpired' }),
      onStatus: setConnection,
      onFatal: (status) =>
        dispatch({
          type: 'conversationLost',
          error:
            status === 401
              ? 'Votre session a expiré. Commencez une nouvelle conversation.'
              : 'Cette conversation n’est plus disponible. Commencez-en une nouvelle.',
        }),
    });
    if (!resuming) setLoadingHistory(false);
    stream.start();
    return () => stream.stop();
  }, [c1, conversationId]);

  const post = useCallback(
    async (input: MessageInput): Promise<void> => {
      const id = await ensureConversation();
      if (!id) {
        dispatch({ type: 'userMessageFailed', id: input.id });
        return;
      }
      let next: MessageInput | undefined = input;
      while (next) {
        const current: MessageInput = next;
        try {
          await c1.sendMessage(id, current);
          dispatch({ type: 'userMessageAccepted', id: current.id });
        } catch {
          dispatch({ type: 'userMessageFailed', id: current.id });
          return;
        }
        // The following message of the chain goes out once this one is accepted (also after a retry).
        accepted.current.add(current.id);
        const nextId = nextOf.current.get(current.id);
        next = nextId ? held.current.get(nextId) : undefined;
        if (next && nextId) {
          held.current.delete(nextId);
          pending.current.set(nextId, next);
        }
      }
    },
    [c1, ensureConversation],
  );

  const upload = useCallback(
    async (id: string, entry: PendingUpload) => {
      try {
        // Conversation first: a single call opens the guest session, the upload follows.
        if (!(await ensureConversation())) throw new Error('conversation');
        const uploaded = await c1.uploadFile(entry.file, entry.mimeType, entry.uploadKey);
        dispatch({ type: 'fileUploadSucceeded', id, file: uploaded, documentType: entry.documentType });
        const input: MessageInput = {
          id,
          content: fileContent(uploaded, entry.documentType),
          sentAt: entry.sentAt,
        };
        const prevId = prevOf.current.get(id);
        if (prevId && !accepted.current.has(prevId)) {
          // The previous message is not accepted yet: it releases this one.
          held.current.set(id, input);
          return;
        }
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
    [c1, post, ensureConversation],
  );

  const sendFiles = useCallback(
    (files: File[], note?: string, voice?: { durationMs: number; waveform: number[] }, documentType: string | null = null) => {
      const text = note?.trim();
      if (text && text.length > MAX_TEXT_LENGTH) return;
      const valid = files.flatMap((file) => {
        const validation = validateFile(file, CONTRACT_MIME_TYPES);
        return validation.ok ? [{ file, mimeType: validation.mimeType }] : [];
      });
      if (valid.length === 0) return;
      const batchId = newId('batch');
      const started: [string, PendingUpload][] = [];
      let previousId: string | undefined;
      const link = (id: string) => {
        if (previousId) {
          prevOf.current.set(id, previousId);
          nextOf.current.set(previousId, id);
        }
        previousId = id;
      };
      for (const { file, mimeType } of valid) {
        const id = newId('msg');
        const entry: PendingUpload = {
          file,
          // Only a document can answer a `fileRequest`; a voice message is plain audio.
          documentType: mimeType.startsWith('audio/') ? null : documentType,
          mimeType,
          uploadKey: crypto.randomUUID(),
          sentAt: new Date().toISOString(),
        };
        uploads.current.set(id, entry);
        link(id);
        started.push([id, entry]);
        // The file name stays local: it is never sent to the backend.
        let previewUrl: string | undefined;
        if ((mimeType.startsWith('image/') || mimeType.startsWith('audio/')) && typeof URL.createObjectURL === 'function') {
          previewUrl = URL.createObjectURL(file);
          previewUrls.current.push(previewUrl);
        }
        dispatch({
          type: 'fileUploadStarted',
          id,
          attachment: {
            name: file.name,
            sizeBytes: file.size,
            mimeType,
            previewUrl,
            ...(voice && mimeType.startsWith('audio/') ? { durationMs: voice.durationMs, waveform: voice.waveform } : {}),
          },
          sentAt: entry.sentAt,
          batchId,
        });
      }
      if (text) {
        // Shown right after the files; posted only once the last file message is accepted.
        const noteInput: MessageInput = {
          id: newId('msg'),
          content: { type: 'text', text },
          sentAt: new Date().toISOString(),
        };
        link(noteInput.id);
        held.current.set(noteInput.id, noteInput);
        dispatch({ type: 'userMessageQueued', id: noteInput.id, content: noteInput.content, display: text, sentAt: noteInput.sentAt, batchId });
      }
      // Uploads run in parallel; the message POSTs are chained.
      for (const [id, entry] of started) void upload(id, entry);
    },
    [upload],
  );

  const sendFile = useCallback((file: File, note?: string) => sendFiles([file], note), [sendFiles]);

  const enqueue = useCallback(
    (content: MessageInput['content'], display: string) => {
      const input: MessageInput = { id: newId('msg'), content, sentAt: new Date().toISOString() };
      pending.current.set(input.id, input);
      dispatch({ type: 'userMessageQueued', id: input.id, content, display, sentAt: input.sentAt });
      void post(input);
    },
    [post],
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
      let input = pending.current.get(entryId);
      const entry = uploads.current.get(entryId);
      if (!input && !entry) {
        // Restored after a reload: the content is in the timeline entry.
        const restoredEntry = state.timeline.find((e) => e.kind === 'user' && e.id === entryId);
        if (restoredEntry?.kind === 'user' && restoredEntry.delivery === 'failed' && restoredEntry.content) {
          input = { id: restoredEntry.id, content: restoredEntry.content, sentAt: restoredEntry.sentAt };
          pending.current.set(entryId, input);
        }
      }
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

  // Consent: the `consent` block brings the challenge; the click calls POST …/mandates (CONTRACTS.md §7.3).
  const [consents, setConsents] = useState<Record<string, ConsentState>>({});
  const setConsent = useCallback((id: string, next: ConsentState) => setConsents((all) => ({ ...all, [id]: next })), []);

  const accept = useCallback(
    async (challenge: Challenge) => {
      const id = conversationRef.current;
      if (!id) return;
      setConsent(challenge.id, { phase: 'accepting' });
      try {
        // Stable key per challenge: a retry replays the same answer.
        await c1.createMandate(id, { challengeId: challenge.id, accepted: true }, `consent-${challenge.id}`);
        setConsent(challenge.id, { phase: 'accepted' });
      } catch (error) {
        const status = error instanceof C1Error ? error.status : undefined;
        setConsent(
          challenge.id,
          status === 403 || status === 404 || status === 409
            ? { phase: 'invalid' }
            : { phase: 'error', message: 'Impossible d’enregistrer votre autorisation pour le moment. Réessayez.' },
        );
      }
    },
    [c1, setConsent],
  );

  const refuse = useCallback((challenge: Challenge) => setConsent(challenge.id, { phase: 'refused' }), [setConsent]);

  // Only the id survives a reload; the history gives the rest back.
  useEffect(() => {
    if (conversationId) saveConversation({ conversationId });
  }, [conversationId]);

  const consent: ConsentControls = useMemo(() => ({ states: consents, accept: (c) => void accept(c), refuse }), [consents, accept, refuse]);

  return { state, connection, loadingHistory, sendText, sendButton, sendForm, sendFile, sendFiles, retry, consent };
}
