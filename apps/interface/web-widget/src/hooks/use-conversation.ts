'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { C1Client, C1Error, type MessageInput } from '@/lib/c1-client';
import { ConversationStream, type StreamStatus } from '@/lib/conversation-stream';
import {
  MANDATE_SCOPES,
  idleFlow,
  resolveProcedureId,
  toPublicChallenge,
  type ConsentControls,
  type ConsentFlow,
  type PublicChallenge,
} from '@/lib/consent';
import { conversationReducer, initialState, type ConversationState } from '@/lib/conversation-state';
import { saveConversation, type ConversationSnapshot } from '@/lib/conversation-persistence';
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
const SAVE_DEBOUNCE_MS = 150;

function stateFromSnapshot(snapshot: ConversationSnapshot | null | undefined): ConversationState {
  if (!snapshot) return initialState;
  const { mandate: _mandate, ...rest } = snapshot;
  return { ...initialState, ...rest, status: 'ready' };
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

  useEffect(() => {
    if (resumed.current) return;
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

  // Realtime (CONTRACTS.md §5): WebSocket with polling fallback, owned by ConversationStream.
  const conversationId = state.conversationId;
  const [connection, setConnection] = useState<StreamStatus>('connecting');
  useEffect(() => {
    if (!conversationId) return;
    const stream = new ConversationStream({
      client: c1,
      conversationId,
      initialCursor: resumed.current?.conversationId === conversationId ? resumed.current.cursor : null,
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
    stream.start();
    return () => stream.stop();
  }, [c1, conversationId]);

  const post = useCallback(
    async (input: MessageInput): Promise<void> => {
      if (!conversationId) return;
      let next: MessageInput | undefined = input;
      while (next) {
        const current: MessageInput = next;
        try {
          await c1.sendMessage(conversationId, current);
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
    [c1, conversationId],
  );

  const upload = useCallback(
    async (id: string, entry: PendingUpload) => {
      try {
        const uploaded = await c1.uploadFile(entry.file, entry.mimeType, entry.uploadKey);
        dispatch({ type: 'fileUploadSucceeded', id, file: uploaded });
        const input: MessageInput = {
          id,
          content: { type: contentTypeFor(uploaded.mimeType), fileId: uploaded.id },
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
    [c1, post],
  );

  const sendFiles = useCallback(
    (files: File[], note?: string, voice?: { durationMs: number; waveform: number[] }) => {
      if (!conversationId) return;
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
    [conversationId, upload],
  );

  const sendFile = useCallback((file: File, note?: string) => sendFiles([file], note), [sendFiles]);

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

  // Consent (mandate) flow, driven by the Backend `tool.called` MANDATE_* trigger held in the reducer state.
  const [flow, setFlow] = useState<ConsentFlow>(() =>
    restored?.mandate ? { phase: 'active', mandate: restored.mandate } : idleFlow,
  );
  const attempt = useRef(0); // results of an older attempt are ignored
  const challengeKey = useRef('');
  const revokeKey = useRef('');
  const challenge = useRef<PublicChallenge | null>(null);
  const mandate = useRef<{ id: string; expiresAt: string } | null>(restored?.mandate ?? null);
  // A trigger answered by a restored active mandate must not request a new challenge.
  const handledTrigger = useRef<string | null>(restored?.mandate ? (restored.consent?.eventId ?? null) : null);
  const procedureId = resolveProcedureId(state);
  const lastProcedure = useRef<string | null>(null);
  lastProcedure.current = procedureId;

  const requestChallenge = useCallback(
    async (procedure: string, key: string) => {
      if (!conversationId) return;
      const mine = ++attempt.current;
      challengeKey.current = key;
      setFlow({ phase: 'requesting' });
      try {
        const created = await c1.createMandateChallenge(conversationId, { procedureId: procedure, scopes: MANDATE_SCOPES }, key);
        if (mine !== attempt.current) return;
        challenge.current = toPublicChallenge(created);
        setFlow({ phase: 'pending', challenge: challenge.current });
      } catch {
        if (mine !== attempt.current) return;
        setFlow({ phase: 'error', during: 'challenge', message: 'Impossible de demander l’autorisation pour le moment.' });
      }
    },
    [c1, conversationId],
  );

  const renew = useCallback(() => {
    const procedure = lastProcedure.current;
    if (!procedure) {
      setFlow({ phase: 'noProcedure' });
      return;
    }
    void requestChallenge(procedure, crypto.randomUUID());
  }, [requestChallenge]);

  const trigger = state.consent;
  useEffect(() => {
    if (!trigger || !conversationId) return;
    if (handledTrigger.current !== trigger.eventId) {
      handledTrigger.current = trigger.eventId;
      if (trigger.code === 'MANDATE_REVOKED' && ['active', 'revoking', 'revoked'].includes(flow.phase)) {
        attempt.current++;
        setFlow({ phase: 'revoked' });
        return;
      }
      renew();
    } else if (flow.phase === 'noProcedure' && procedureId) {
      renew();
    }
  }, [trigger, conversationId, procedureId, flow.phase, renew]);

  const accept = useCallback(async () => {
    const current = challenge.current;
    if (!conversationId || !current) return;
    const mine = ++attempt.current;
    setFlow({ phase: 'accepting', challenge: current });
    try {
      const granted = await c1.createMandate(conversationId, { challengeId: current.id, accepted: true }, `consent-${current.id}`);
      if (mine !== attempt.current) return;
      mandate.current = { id: granted.id, expiresAt: granted.expiresAt };
      setFlow({ phase: 'active', mandate: mandate.current });
    } catch (error) {
      if (mine !== attempt.current) return;
      const status = error instanceof C1Error ? error.status : undefined;
      setFlow(
        status === 403 || status === 409
          ? { phase: 'invalid' }
          : { phase: 'error', during: 'accept', message: 'Impossible d’enregistrer votre autorisation pour le moment.' },
      );
    }
  }, [c1, conversationId]);

  const retract = useCallback(
    async (reuseKey = false) => {
      const current = mandate.current;
      if (!conversationId || !current) return;
      if (!reuseKey) revokeKey.current = crypto.randomUUID();
      const mine = ++attempt.current;
      setFlow({ phase: 'revoking', mandate: current });
      try {
        await c1.revokeMandate(conversationId, current.id, revokeKey.current);
        if (mine !== attempt.current) return;
        setFlow({ phase: 'revoked' });
      } catch {
        if (mine !== attempt.current) return;
        setFlow({ phase: 'error', during: 'revoke', message: 'Impossible de retirer l’autorisation pour le moment.' });
      }
    },
    [c1, conversationId],
  );

  const retryConsent = useCallback(() => {
    if (flow.phase !== 'error') return;
    if (flow.during === 'accept') void accept();
    else if (flow.during === 'revoke') void retract(true);
    else if (lastProcedure.current) void requestChallenge(lastProcedure.current, challengeKey.current);
  }, [flow, accept, retract, requestChallenge]);

  const refuse = useCallback(() => {
    // Nothing to consume server-side: the challenge simply expires.
    attempt.current++;
    setFlow({ phase: 'refused' });
  }, []);

  const resume = useCallback(() => {
    // Re-send the user's last text message so the agent retries the action now that a mandate exists.
    const lastText = [...state.timeline].reverse().find((e) => e.kind === 'user' && e.content?.type === 'text');
    if (lastText?.kind === 'user' && lastText.content?.type === 'text') sendText(lastText.content.text);
  }, [state.timeline, sendText]);

  // Persist after state changes (debounced) and when the page goes away.
  const snapshot = useRef<ConversationSnapshot | null>(null);
  snapshot.current =
    state.conversationId && state.timeline.length > 0
      ? {
          conversationId: state.conversationId,
          cursor: state.cursor,
          seenEventIds: state.seenEventIds,
          timeline: state.timeline,
          requestProcedureId: state.requestProcedureId,
          consent: state.consent,
          // A request in flight counts as the previous stable phase: only an active mandate is kept.
          mandate: flow.phase === 'active' || flow.phase === 'revoking' ? flow.mandate : null,
        }
      : null;
  useEffect(() => {
    const timer = setTimeout(() => {
      if (snapshot.current) saveConversation(snapshot.current);
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state, flow]);
  useEffect(() => {
    const flush = () => {
      if (snapshot.current) saveConversation(snapshot.current);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const consent: ConsentControls = useMemo(
    () => ({
      flow,
      accept: () => void accept(),
      refuse,
      renew,
      retry: retryConsent,
      retract: () => void retract(),
      resume,
    }),
    [flow, accept, refuse, renew, retryConsent, retract, resume],
  );

  return { state, connection, sendText, sendButton, sendForm, sendFile, sendFiles, retry, consent };
}
