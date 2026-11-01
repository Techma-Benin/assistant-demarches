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

  // Realtime (CONTRACTS.md §5): WebSocket with polling fallback, owned by ConversationStream.
  const conversationId = state.conversationId;
  const [connection, setConnection] = useState<StreamStatus>('connecting');
  useEffect(() => {
    if (!conversationId) return;
    const stream = new ConversationStream({
      client: c1,
      conversationId,
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

  // Consent (mandate) flow, driven by the Backend `tool.called` MANDATE_* trigger held in the reducer state.
  const [flow, setFlow] = useState<ConsentFlow>(idleFlow);
  const attempt = useRef(0); // results of an older attempt are ignored
  const challengeKey = useRef('');
  const revokeKey = useRef('');
  const challenge = useRef<PublicChallenge | null>(null);
  const mandate = useRef<{ id: string; expiresAt: string } | null>(null);
  const handledTrigger = useRef<string | null>(null);
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

  return { state, connection, sendText, sendButton, sendForm, sendFile, retry, consent };
}
