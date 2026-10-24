'use client';

import { useEffect, useRef, useState } from 'react';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import { useConversation } from '@/hooks/use-conversation';
import type { Delivery, TimelineEntry } from '@/lib/conversation-state';
import { Composer } from './Composer';

const DELIVERY_LABELS: Record<Exclude<Delivery, 'failed'>, string> = {
  sending: 'Envoi…',
  accepted: 'Envoyé',
  received: 'Reçu',
};

function Conversation({ onRestart }: { onRestart: () => void }) {
  const { state, sendText, sendButton, sendForm, retry } = useConversation();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [state.timeline.length]);

  let lastAgentIndex = -1;
  state.timeline.forEach((entry, index) => {
    if (entry.kind === 'agent') lastAgentIndex = index;
  });

  if (state.status === 'error') {
    return <ErrorPanel message={state.error ?? 'Une erreur est survenue.'} onRetry={onRestart} />;
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3">
        {state.status === 'starting' && <p className="text-sm text-slate-500">Connexion…</p>}
        {state.status === 'ready' && state.timeline.length === 0 && (
          <div className="mx-auto mt-8 max-w-xs text-center text-sm text-slate-600">
            <p className="font-medium text-slate-800">Bonjour !</p>
            <p className="mt-1">
              Posez votre question sur une démarche administrative. L’assistant vous répond en citant ses sources.
            </p>
          </div>
        )}
        <div role="log" aria-live="polite" aria-label="Conversation" className="space-y-3">
          {state.timeline.map((entry: TimelineEntry, index) =>
            entry.kind === 'user' ? (
              <div key={entry.id} className="flex flex-col items-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-blue-700 px-3 py-2 text-white">
                  {entry.display}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {entry.delivery === 'failed' ? (
                    <button type="button" onClick={() => retry(entry.id)} className="text-red-700 underline">
                      Échec — Réessayer
                    </button>
                  ) : (
                    DELIVERY_LABELS[entry.delivery]
                  )}
                </div>
              </div>
            ) : (
              <div key={entry.message.id} className="flex flex-col items-start space-y-2">
                {entry.message.blocks.map((block, blockIndex) => (
                  <div
                    key={blockIndex}
                    className="max-w-[85%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3 py-2"
                  >
                    <BlockRenderer
                      block={block}
                      interactive={index === lastAgentIndex}
                      onButton={sendButton}
                      onForm={sendForm}
                    />
                  </div>
                ))}
              </div>
            ),
          )}
        </div>
        <div ref={endRef} />
      </div>
      <Composer disabled={state.status !== 'ready'} onSend={sendText} />
    </>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p role="alert">{message}</p>
      <button type="button" onClick={onRetry} className="rounded bg-blue-700 px-4 py-2 text-sm text-white">
        Réessayer
      </button>
    </div>
  );
}

export function ChatWidget() {
  // Changing the key remounts the conversation (used by "Réessayer").
  const [attempt, setAttempt] = useState(0);
  return (
    <section aria-label="Assistant démarches" className="flex h-full w-full flex-col bg-white">
      <header className="border-b border-slate-200 px-4 py-3">
        <h1 className="text-lg font-semibold">Assistant démarches</h1>
        <p className="text-xs text-slate-500">Simulation — démarches fictives</p>
      </header>
      <Conversation key={attempt} onRestart={() => setAttempt((n) => n + 1)} />
    </section>
  );
}
