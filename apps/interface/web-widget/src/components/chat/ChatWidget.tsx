'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, BrandMark, Button, FlagGlyph, Chip, InlineAlert, ThemeToggle, TypingIndicator, cn } from '@techma/ui';
import { AudioLines, Check, CheckCheck, Clock, FileText, Image as ImageIcon, Loader } from 'lucide-react';
import { BlockRenderer, isBareBlock } from '@/components/blocks/BlockRenderer';
import { useConversation } from '@/hooks/use-conversation';
import type { TimelineEntry } from '@/lib/conversation-state';
import { formatFileSize, mimeLabel } from '@/lib/files';
import { Composer } from './Composer';
import { ConnectionNotice } from './ConnectionNotice';

const SUGGESTIONS = ['Quelles démarches pouvez-vous m’expliquer ?', 'Comment ça marche ?'];

type UserEntry = Extract<TimelineEntry, { kind: 'user' }>;

function DeliveryLine({ entry, onRetry }: { entry: UserEntry; onRetry: () => void }) {
  const base = 'mt-1 flex items-center gap-1 text-[13px]';
  const icon = 'size-3.5 shrink-0';
  switch (entry.delivery) {
    case 'sending':
      return (
        <div className={`${base} text-ink-subtle`}>
          <Clock aria-hidden="true" className={icon} />
          Envoi…
        </div>
      );
    case 'accepted':
      return (
        <div className={`${base} text-ink-subtle`}>
          <Check aria-hidden="true" className={icon} />
          Envoyé
        </div>
      );
    case 'received':
      return (
        <div className={`${base} text-ink-subtle`}>
          <CheckCheck aria-hidden="true" className={icon} />
          Reçu
        </div>
      );
    case 'uploading':
      return (
        <div className={`${base} text-ink-subtle`}>
          <Loader aria-hidden="true" className={`${icon} motion-safe:animate-spin`} />
          Envoi de la pièce…
        </div>
      );
    case 'failed':
      return (
        <div className={`${base} flex-wrap justify-end text-danger`}>
          Échec de l’envoi
          <Button variant="ghost" size="sm" onClick={onRetry}>
            Réessayer
          </Button>
        </div>
      );
    case 'uploadFailed':
      return (
        <div className={`${base} flex-wrap justify-end text-danger`}>
          {entry.error}
          {entry.retryable && (
            <Button variant="ghost" size="sm" onClick={onRetry}>
              Réessayer
            </Button>
          )}
        </div>
      );
    case 'scanRejected':
      return <div className={`${base} text-danger`}>{entry.error}</div>;
  }
}

function AgentRow({ avatar, children }: { avatar: boolean; children: ReactNode }) {
  return (
    <div className="ui-enter flex items-end gap-2">
      {avatar ? <FlagGlyph decorative width={32} height={24} className="shrink-0" /> : <span className="w-8 shrink-0" aria-hidden="true" />}
      {children}
    </div>
  );
}

function Conversation({ onRestart }: { onRestart: () => void }) {
  const { state, connection, sendText, sendButton, sendForm, sendFile, retry } = useConversation();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [state.timeline.length]);

  let lastAgentIndex = -1;
  state.timeline.forEach((entry, index) => {
    if (entry.kind === 'agent') lastAgentIndex = index;
  });

  if (state.status === 'error') {
    return (
      <ErrorPanel
        message={state.error ?? 'Une erreur est survenue.'}
        actionLabel={state.lost ? 'Nouvelle conversation' : 'Réessayer'}
        onRetry={onRestart}
      />
    );
  }

  const last = state.timeline[state.timeline.length - 1];
  const waitingForAgent = last?.kind === 'user' && (last.delivery === 'accepted' || last.delivery === 'received');
  const ready = state.status === 'ready';

  return (
    <>
      {ready && <ConnectionNotice connection={connection} />}
      <div className="ui-scrollbar-none min-h-0 flex-1 overflow-y-auto bg-canvas p-3">
        {state.status === 'starting' && (
          <div className="flex items-center gap-2 text-ink-muted">
            <TypingIndicator label="Connexion…" />
            <span aria-hidden="true">Connexion…</span>
          </div>
        )}
        {ready && state.timeline.length === 0 && (
          <div className="mx-auto mt-10 flex max-w-xs flex-col items-center gap-3 text-center">
            <BrandMark size="lg" />
            <h2 className="text-[22px] font-extrabold">Bonjour !</h2>
            <p className="text-ink-muted">
              Posez votre question sur une démarche administrative. Je vous réponds en citant mes sources.
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Chip key={suggestion} onClick={() => sendText(suggestion)}>
                  {suggestion}
                </Chip>
              ))}
            </div>
          </div>
        )}
        <div role="log" aria-live="polite" aria-label="Conversation" className="flex flex-col gap-3">
          {state.timeline.map((entry: TimelineEntry, index) =>
            entry.kind === 'user' ? (
              <div key={entry.id} className="ui-enter flex flex-col items-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-card rounded-br-md bg-action px-4 py-2.5 text-on-action">
                  {entry.attachment ? <AttachmentRow attachment={entry.attachment} /> : entry.display}
                </div>
                <DeliveryLine entry={entry} onRetry={() => retry(entry.id)} />
              </div>
            ) : (
              <div key={entry.message.id} className="flex flex-col gap-3">
                {entry.message.blocks.map((block, blockIndex) => (
                  <AgentRow
                    key={blockIndex}
                    avatar={blockIndex === 0 && state.timeline[index - 1]?.kind !== 'agent'}
                  >
                    <div
                      className={cn(
                        'min-w-0 max-w-[85%]',
                        !isBareBlock(block) && 'rounded-card rounded-bl-md border border-line bg-surface px-4 py-3',
                      )}
                    >
                      <BlockRenderer
                        block={block}
                        interactive={index === lastAgentIndex}
                        onButton={sendButton}
                        onForm={sendForm}
                        onFile={sendFile}
                      />
                    </div>
                  </AgentRow>
                ))}
              </div>
            ),
          )}
          {waitingForAgent && (
            <AgentRow avatar>
              <div className="rounded-card rounded-bl-md border border-line bg-surface px-4 py-2">
                <TypingIndicator />
              </div>
            </AgentRow>
          )}
        </div>
        <div ref={endRef} />
      </div>
      <Composer disabled={!ready} onSend={sendText} onFile={sendFile} />
    </>
  );
}

function AttachmentRow({ attachment }: { attachment: NonNullable<UserEntry['attachment']> }) {
  const Icon = attachment.mimeType.startsWith('image/')
    ? ImageIcon
    : attachment.mimeType.startsWith('audio/')
      ? AudioLines
      : FileText;
  return (
    <div className="flex items-center gap-3">
      <Icon aria-hidden="true" className="size-6 shrink-0" />
      <div className="min-w-0 space-y-0.5">
        <p className="max-w-[12rem] truncate font-semibold" title={attachment.name}>
          {attachment.name}
        </p>
        <p className="text-[13px] opacity-80">
          {formatFileSize(attachment.sizeBytes)} · {mimeLabel(attachment.mimeType)}
        </p>
        {attachment.scanStatus === 'pending' && (
          <Badge tone="warning" className="mt-1">
            Analyse de sécurité en cours
          </Badge>
        )}
      </div>
    </div>
  );
}

function ErrorPanel({ message, actionLabel, onRetry }: { message: string; actionLabel: string; onRetry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
      <InlineAlert>{message}</InlineAlert>
      <Button variant="secondary" onClick={onRetry}>
        {actionLabel}
      </Button>
    </div>
  );
}

export function ChatWidget() {
  // Changing the key remounts the conversation (used by "Réessayer").
  const [attempt, setAttempt] = useState(0);
  return (
    <section aria-label="Assistant démarches" className="flex h-full w-full flex-col bg-canvas">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <FlagGlyph decorative width={30} height={22} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-extrabold leading-tight">Assistant démarches</h1>
          <p className="text-[13px] text-ink-muted">Réponses sourcées</p>
        </div>
        <Badge tone="neutral">Démo</Badge>
        <ThemeToggle />
      </header>
      <Conversation key={attempt} onRestart={() => setAttempt((n) => n + 1)} />
    </section>
  );
}
