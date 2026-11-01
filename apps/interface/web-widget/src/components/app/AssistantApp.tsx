'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { ConversationView } from '@/components/chat/ConversationView';
import { FrontDoor } from '@/components/home/FrontDoor';
import { useConversation } from '@/hooks/use-conversation';
import { clearConversation, loadConversation, type ConversationSnapshot } from '@/lib/conversation-persistence';
import type { TimelineEntry } from '@/lib/conversation-state';

export type AppView = 'home' | 'conversation';

type Voice = { durationMs: number; waveform: number[] };
/** The first input of a new conversation, sent once the session is ready. */
type FirstInput = { text: string } | { files: File[]; note?: string; voice?: Voice };

const CONVERSATION_PATH = '/conversation';

/** First text question; else a label for a voice or file-only opening. */
function conversationTitle(timeline: TimelineEntry[]): string | null {
  const text = timeline.find((entry) => entry.kind === 'user' && !entry.attachment);
  if (text?.kind === 'user') return text.display;
  const first = timeline.find((entry) => entry.kind === 'user');
  if (first?.kind !== 'user' || !first.attachment) return null;
  return first.attachment.mimeType.startsWith('audio/') ? 'Message vocal' : 'Pièce jointe';
}

function lastActivity(timeline: TimelineEntry[]): string {
  const last = timeline[timeline.length - 1];
  return last.kind === 'agent' ? last.message.createdAt : last.kind === 'request' ? last.at : last.sentAt;
}

function Session({
  restored,
  view,
  pending,
  hasContent,
  onView,
  onNew,
  onRestart,
  onPendingSent,
}: {
  restored: ConversationSnapshot | null;
  view: AppView;
  pending: FirstInput | null;
  hasContent: MutableRefObject<boolean>;
  onView: (view: AppView) => void;
  onNew: (input: FirstInput) => void;
  onRestart: () => void;
  onPendingSent: () => void;
}) {
  const conversation = useConversation(undefined, restored);
  const { state, sendText, sendFiles } = conversation;
  const ready = state.status === 'ready';
  const hasTimeline = state.timeline.length > 0;
  const dispatch = useCallback(
    (input: FirstInput) => {
      if ('text' in input) sendText(input.text);
      else if (input.voice) sendFiles(input.files, input.note, input.voice);
      else sendFiles(input.files, input.note);
    },
    [sendText, sendFiles],
  );
  useEffect(() => {
    hasContent.current = hasTimeline;
  }, [hasContent, hasTimeline]);

  // Survives StrictMode's double effect run: the queued input goes out once.
  const sent = useRef(false);
  useEffect(() => {
    if (!pending || !ready || sent.current) return;
    sent.current = true;
    dispatch(pending);
    onPendingSent();
  }, [pending, ready, dispatch, onPendingSent]);

  // An error with nothing sent yet goes to the conversation view's retry panel.
  if (view === 'conversation' || (state.timeline.length === 0 && state.status === 'error')) {
    return <ConversationView conversation={conversation} onRestart={onRestart} onHome={() => onView('home')} />;
  }

  // From home, a saved conversation is left alone: asking something new starts a fresh one.
  const start = (input: FirstInput) => {
    if (hasTimeline) {
      onNew(input);
      return;
    }
    dispatch(input);
    onView('conversation');
  };
  return (
    <FrontDoor
      onAsk={(text) => start({ text })}
      onFiles={(files, note, voice) => start({ files, note, voice })}
      disabled={!ready}
      resume={
        hasTimeline
          ? { title: conversationTitle(state.timeline), at: lastActivity(state.timeline), onResume: () => onView('conversation') }
          : undefined
      }
    />
  );
}

/** Public page: `/` is the front door, `/conversation` the chat. A reload resumes the saved conversation; asking anew from home replaces it. */
export function AssistantApp({ initialView = 'home' }: { initialView?: AppView }) {
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<AppView>(initialView);
  const [pending, setPending] = useState<FirstInput | null>(null);
  // undefined until the browser storage was read: server and first client render agree, no hydration mismatch.
  const [restored, setRestored] = useState<ConversationSnapshot | null | undefined>(undefined);
  const hasContent = useRef(false);
  const pendingRef = useRef<FirstInput | null>(null);
  pendingRef.current = pending;

  // History is driven by hand: router navigation would remount the session and drop uploads in flight.
  const go = useCallback((next: AppView) => {
    const path = next === 'home' ? '/' : CONVERSATION_PATH;
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
    setView(next);
  }, []);

  useLayoutEffect(() => {
    const snapshot = loadConversation();
    if (initialView === 'conversation' && !snapshot) {
      window.history.replaceState(null, '', '/');
      setView('home');
    }
    setRestored(snapshot);
  }, [initialView]);

  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname !== CONVERSATION_PATH) {
        setView('home');
      } else if (hasContent.current || pendingRef.current) {
        setView('conversation');
      } else {
        window.history.replaceState(null, '', '/');
        setView('home');
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const fresh = (first: FirstInput | null) => {
    clearConversation();
    hasContent.current = false;
    setRestored(null);
    setPending(first);
    setAttempt((n) => n + 1);
  };

  if (restored === undefined) {
    // Home is server-rendered; its session starts once the storage is known.
    return initialView === 'home' ? <FrontDoor onAsk={() => {}} disabled /> : null;
  }
  return (
    <Session
      key={attempt}
      restored={restored}
      view={view}
      pending={pending}
      hasContent={hasContent}
      onView={go}
      onNew={(input) => {
        fresh(input);
        go('conversation');
      }}
      onRestart={() => {
        fresh(null);
        go('home');
      }}
      onPendingSent={() => setPending(null)}
    />
  );
}
