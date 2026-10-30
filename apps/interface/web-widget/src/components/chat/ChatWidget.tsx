'use client';

import { useState } from 'react';
import { useConversation } from '@/hooks/use-conversation';
import { ConversationView } from './ConversationView';

function Session({ onRestart }: { onRestart: () => void }) {
  const conversation = useConversation();
  return <ConversationView conversation={conversation} onRestart={onRestart} />;
}

export function ChatWidget() {
  // Changing the key remounts the conversation (used by "Réessayer").
  const [attempt, setAttempt] = useState(0);
  return <Session key={attempt} onRestart={() => setAttempt((n) => n + 1)} />;
}
