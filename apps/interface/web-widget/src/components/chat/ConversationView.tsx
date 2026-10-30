'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { BrandMark, Button, Chip, SourceList, StepTracker, ThemeToggle, TypingIndicator, cn } from '@techma/ui';
import { ChevronDown, Plus } from 'lucide-react';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import type { useConversation } from '@/hooks/use-conversation';
import type { TimelineEntry } from '@/lib/conversation-state';
import { deriveDossierSteps, lastTextSources, toSourceInfo } from '@/lib/dossier';
import { Composer } from './Composer';
import { ConnectionNotice } from './ConnectionNotice';
import { AttachmentRow, DeliveryLine, ErrorPanel } from './UserEntryParts';

const SUGGESTIONS = ['Quelles démarches pouvez-vous m’expliquer ?', 'Comment ça marche ?'];

const PANEL_TITLE = 'font-display text-[22px] font-extrabold tracking-[-0.03em]';

type Conversation = ReturnType<typeof useConversation>;

function SidePanel({ timeline }: { timeline: TimelineEntry[] }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const steps = deriveDossierSteps(timeline);
  const sources = lastTextSources(timeline).map((source, index) => toSourceInfo(source, index, true));

  return (
    <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((value) => !value)}
        className="ui-press flex min-h-11 items-center justify-between gap-3 rounded-card bg-sunken px-6 py-3 text-left md:hidden"
      >
        <span className={PANEL_TITLE}>Votre dossier</span>
        <ChevronDown aria-hidden="true" className={cn('size-5 transition-transform', open && 'rotate-180')} />
      </button>
      <div id={regionId} className={cn('flex-col gap-4', open ? 'flex' : 'hidden', 'md:flex')}>
        <section aria-labelledby={`${regionId}-dossier`} className="flex flex-col gap-5 rounded-card bg-sunken p-7">
          <h2 id={`${regionId}-dossier`} className={cn(PANEL_TITLE, 'hidden md:block')}>
            Votre dossier
          </h2>
          <StepTracker steps={steps} />
        </section>
        {sources.length > 0 && (
          <section
            id="sources"
            aria-labelledby={`${regionId}-sources`}
            className="flex flex-col gap-4 rounded-card border border-line bg-surface p-7"
          >
            <h2 id={`${regionId}-sources`} className={PANEL_TITLE}>
              Sources
            </h2>
            <SourceList sources={sources} />
          </section>
        )}
      </div>
    </aside>
  );
}

export function ConversationView({
  conversation,
  onRestart,
}: {
  conversation: Conversation;
  onRestart: () => void;
}) {
  const { state, connection, sendText, sendButton, sendForm, sendFile, retry } = conversation;
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [state.timeline.length]);

  let lastAgentIndex = -1;
  state.timeline.forEach((entry, index) => {
    if (entry.kind === 'agent') lastAgentIndex = index;
  });
  const firstQuestionIndex = state.timeline.findIndex((entry) => entry.kind === 'user' && !entry.attachment);

  const ready = state.status === 'ready';
  const last = state.timeline[state.timeline.length - 1];
  const waitingForAgent = last?.kind === 'user' && (last.delivery === 'accepted' || last.delivery === 'received');

  const header = (
    <header className="border-b border-line-subtle">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-6">
        <a href="/" className="rounded-pill no-underline">
          <BrandMark />
        </a>
        <div className="flex items-center gap-2">
          <Button
            onClick={onRestart}
            aria-label="Nouvelle question"
            className="max-sm:size-12 max-sm:px-0"
            leadingIcon={<Plus aria-hidden="true" className="size-4" strokeWidth={2.6} />}
          >
            {/* Icon only on phones so the header stays on one line. */}
            <span className="max-sm:sr-only">Nouvelle question</span>
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );

  if (state.status === 'error') {
    return (
      <div className="flex min-h-dvh flex-col bg-canvas text-ink">
        {header}
        <ErrorPanel
          message={state.error ?? 'Une erreur est survenue.'}
          actionLabel={state.lost ? 'Nouvelle conversation' : 'Réessayer'}
          onRetry={onRestart}
        />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      {header}
      {ready && <ConnectionNotice connection={connection} />}
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-start gap-x-12 gap-y-8 px-4 pb-44 pt-8 md:px-6 md:pb-16 md:pt-10">
        <main className="flex min-w-0 max-w-[820px] flex-[999_1_620px] flex-col gap-7">
          {state.status === 'starting' && (
            <div className="flex items-center gap-2 text-ink-muted">
              <TypingIndicator label="Connexion…" />
              <span aria-hidden="true">Connexion…</span>
            </div>
          )}
          {ready && state.timeline.length === 0 && (
            <div className="flex flex-col gap-4">
              <h1 className="m-0 font-display text-[clamp(36px,4.4vw,56px)] font-extrabold leading-none tracking-[-0.045em]">
                Bonjour !
              </h1>
              <p className="m-0 text-[19px] leading-[1.6] text-ink-muted">
                Posez votre question sur une démarche administrative. Je vous réponds en citant mes sources.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <Chip key={suggestion} onClick={() => sendText(suggestion)}>
                    {suggestion}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <div role="log" aria-live="polite" aria-label="Conversation" className="flex flex-col gap-7">
            {state.timeline.map((entry, index) => {
              if (entry.kind === 'agent') {
                return (
                  <div key={entry.message.id} className="ui-enter flex flex-col gap-[22px]">
                    {entry.message.blocks.map((block, blockIndex) => (
                      <BlockRenderer
                        key={blockIndex}
                        block={block}
                        interactive={index === lastAgentIndex}
                        onButton={sendButton}
                        onForm={sendForm}
                        onFile={sendFile}
                      />
                    ))}
                  </div>
                );
              }
              if (index === firstQuestionIndex) {
                return (
                  <div key={entry.id} className="ui-enter flex flex-col">
                    <h1 className="m-0 break-words font-display text-[clamp(36px,4.4vw,56px)] font-extrabold leading-none tracking-[-0.045em]">
                      {entry.display}
                    </h1>
                    <DeliveryLine entry={entry} onRetry={() => retry(entry.id)} align="start" />
                  </div>
                );
              }
              return (
                <div key={entry.id} className="ui-enter flex flex-col items-end">
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[24px] bg-sunken px-[22px] py-3.5 text-[17px] font-medium">
                    {entry.attachment ? <AttachmentRow attachment={entry.attachment} /> : entry.display}
                  </div>
                  <DeliveryLine entry={entry} onRetry={() => retry(entry.id)} />
                </div>
              );
            })}
            {waitingForAgent && <TypingIndicator className="py-2" />}
          </div>
          <div ref={endRef} className="scroll-mb-44" />
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line-subtle bg-canvas px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:static md:z-auto md:mt-3 md:border-0 md:bg-transparent md:p-0">
            <Composer disabled={!ready} onSend={sendText} onFile={sendFile} />
          </div>
        </main>
        <SidePanel timeline={state.timeline} />
      </div>
    </div>
  );
}
