'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { ConversationView } from '@/components/chat/ConversationView';
import { FrontDoor } from '@/components/home/FrontDoor';
import { useConversation } from '@/hooks/use-conversation';
import { useSessionUser } from '@/hooks/use-session-user';
import { C1Client } from '@/lib/c1-client';
import { clearConversation, loadConversation, saveConversation, type ConversationSnapshot } from '@/lib/conversation-persistence';
import type { TimelineEntry } from '@/lib/conversation-state';

export type AppView = 'home' | 'conversation';

type Voice = { durationMs: number; waveform: number[] };
/** The first input of a new conversation, sent once the session has mounted. */
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
  return last.kind === 'agent' ? last.message.createdAt : last.sentAt;
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
  // No conversation exists before the first message (lazy start), so a send is possible unless the session is lost.
  const canSend = state.status !== 'error';
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
    if (!pending || !canSend || sent.current) return;
    sent.current = true;
    dispatch(pending);
    onPendingSent();
  }, [pending, canSend, dispatch, onPendingSent]);

  // A signed-in person on a new tab has no saved conversation: offer the newest one of their account.
  // Never asked for a guest: the call would open a guest session for nothing.
  const { status: access } = useSessionUser();
  const [remote, setRemote] = useState<{ id: string; at: string } | null>(null);
  const lookup = view === 'home' && !hasTimeline && access === 'user';
  useEffect(() => {
    if (!lookup) return;
    let cancelled = false;
    new C1Client()
      .listConversations(null, 1)
      .then((page) => {
        const newest = page.items[0];
        // `lastMessageAt` may be missing even when the conversation has messages: fall back to its creation.
        if (!cancelled && newest) setRemote({ id: newest.id, at: newest.lastMessageAt ?? newest.createdAt });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lookup]);

  if (view === 'conversation') {
    return <ConversationView conversation={conversation} onRestart={onRestart} onHome={() => onView('home')} />;
  }

  // The home page never depends on the Backend: a failed start stays silent until the visitor asks.
  const failed = state.status === 'error';
  // From home, a saved conversation is left alone: asking something new starts a fresh one (also the retry after a failed start).
  const start = (input: FirstInput) => {
    if (hasTimeline || failed) {
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
      resume={
        hasTimeline
          ? { title: conversationTitle(state.timeline), at: lastActivity(state.timeline), onResume: () => onView('conversation') }
          : remote
            ? {
                title: null,
                at: remote.at,
                onResume: () => {
                  saveConversation({ conversationId: remote.id });
                  window.location.assign(CONVERSATION_PATH);
                },
              }
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
