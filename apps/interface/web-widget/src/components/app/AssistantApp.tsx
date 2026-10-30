'use client';

import { useState } from 'react';
import { ConversationView } from '@/components/chat/ConversationView';
import { FrontDoor } from '@/components/home/FrontDoor';
import { useConversation } from '@/hooks/use-conversation';

function Session({ onRestart }: { onRestart: () => void }) {
  const conversation = useConversation();
  const { state, sendText } = conversation;
  // The front door stays until the first question is sent; errors go to the conversation view (retry panel).
  if (state.timeline.length === 0 && state.status !== 'error') {
    return <FrontDoor onAsk={sendText} disabled={state.status !== 'ready'} />;
  }
  return <ConversationView conversation={conversation} onRestart={onRestart} />;
}

/** Public page: front door, then the conversation. Restarting remounts a fresh conversation. */
export function AssistantApp() {
  const [attempt, setAttempt] = useState(0);
  return <Session key={attempt} onRestart={() => setAttempt((n) => n + 1)} />;
}
