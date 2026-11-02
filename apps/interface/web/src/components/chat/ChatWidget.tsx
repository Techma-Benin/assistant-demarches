'use client';

import { useLayoutEffect, useState } from 'react';
import { useConversation } from '@/hooks/use-conversation';
import { clearConversation, loadConversation, type ConversationSnapshot } from '@/lib/conversation-persistence';
import { ConversationView } from './ConversationView';

function Session({ restored, onRestart }: { restored: ConversationSnapshot | null; onRestart: () => void }) {
  const conversation = useConversation(undefined, restored);
  return <ConversationView embedded conversation={conversation} onRestart={onRestart} />;
}

/** The embeddable chat (`/embed`): a full-height conversation. It starts with the first message; a reload resumes it. */
export function ChatWidget() {
  // Changing the key remounts the conversation (« Nouvelle question », « Réessayer »).
  const [attempt, setAttempt] = useState(0);
  // undefined until the browser storage was read: server and first client render agree.
  const [restored, setRestored] = useState<ConversationSnapshot | null | undefined>(undefined);
  useLayoutEffect(() => setRestored(loadConversation()), []);
  if (restored === undefined) return null;
  return (
    <Session
      key={attempt}
      restored={restored}
      onRestart={() => {
        clearConversation();
        setRestored(null);
        setAttempt((n) => n + 1);
      }}
    />
  );
}
