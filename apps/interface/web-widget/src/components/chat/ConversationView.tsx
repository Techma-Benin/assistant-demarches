'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { BrandMark, Button, Chip, SourceList, StepTracker, ThemeToggle, TypingIndicator, cn } from '@techma/ui';
import { ArrowDown, ChevronDown, Plus } from 'lucide-react';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import type { useConversation } from '@/hooks/use-conversation';
import type { TimelineEntry } from '@/lib/conversation-state';
import { deriveDossierSteps, lastTextSources, toSourceInfo } from '@/lib/dossier';
import { Composer } from './Composer';
import { ConnectionNotice } from './ConnectionNotice';
import { AttachmentRow, DeliveryLine, ErrorPanel } from './UserEntryParts';

const SUGGESTIONS = ['Quelles démarches pouvez-vous m’expliquer ?', 'Comment ça marche ?'];

/** Distance (px) from the bottom under which the thread follows new messages. */
const STICK_THRESHOLD = 96;

const PANEL_TITLE = 'font-display text-[22px] font-extrabold tracking-[-0.03em]';

type Conversation = ReturnType<typeof useConversation>;

function SidePanel({ timeline }: { timeline: TimelineEntry[] }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const steps = deriveDossierSteps(timeline);
  const sources = lastTextSources(timeline).map((source, index) => toSourceInfo(source, index, true));

  return (
    <aside className="flex min-h-0 min-w-0 flex-col gap-4 pt-3 md:col-start-2 md:row-span-2 md:row-start-1 md:overflow-y-auto md:py-8 ui-scrollbar-none">
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
      <div
        id={regionId}
        className={cn('ui-scrollbar-none max-h-[45dvh] flex-col gap-4 overflow-y-auto md:max-h-none md:overflow-visible', open ? 'flex' : 'hidden', 'md:flex')}
      >
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  // Follow new messages only while the reader is at the bottom, like a messaging app.
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
    if (smooth && !reduce && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    stick.current = near;
    setAtBottom(near);
  };

  const last = state.timeline[state.timeline.length - 1];
  const waitingForAgent = last?.kind === 'user' && (last.delivery === 'accepted' || last.delivery === 'received');

  // New entry: always jump when the user just sent something, otherwise only if already at the bottom.
  useLayoutEffect(() => {
    if (last?.kind === 'user') stick.current = true;
    if (stick.current) scrollToBottom(state.timeline.length > 1);
  }, [state.timeline.length, waitingForAgent, last?.kind, scrollToBottom]);

  // Content growing in place (form submitted, file pill, fonts) keeps the bottom in view.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (stick.current) scrollToBottom(false);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  let lastAgentIndex = -1;
  state.timeline.forEach((entry, index) => {
    if (entry.kind === 'agent') lastAgentIndex = index;
  });
  const firstQuestionIndex = state.timeline.findIndex((entry) => entry.kind === 'user' && !entry.attachment);

  const ready = state.status === 'ready';

  const header = (
    <header className="shrink-0 border-b border-line-subtle">
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

  // Chat layout: the page never scrolls. Header and composer stay put; only the thread (and the side panel on
  // desktop) scroll. On phones the side panel becomes an accordion between the thread and the composer.
  // The root is `relative` so visually hidden (absolute) inputs stay clipped instead of extending the page scroll.
  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      {header}
      {ready && (
        <div className="shrink-0">
          <ConnectionNotice connection={connection} />
        </div>
      )}
      <div className="mx-auto grid min-h-0 w-full max-w-[1320px] flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_auto_auto] px-4 md:grid-cols-[minmax(0,820px)_minmax(280px,1fr)] md:grid-rows-[minmax(0,1fr)_auto] md:gap-x-12 md:px-6">
        <div className="relative min-h-0 md:col-start-1 md:row-start-1">
          <div ref={scrollRef} onScroll={onScroll} className="ui-scrollbar-none h-full overflow-y-auto overscroll-contain">
            <main ref={contentRef} className="flex min-w-0 flex-col gap-7 pb-6 pt-8 md:pt-10">
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
            </main>
          </div>
          {!atBottom && (
            <button
              type="button"
              aria-label="Aller au dernier message"
              onClick={() => {
                stick.current = true;
                scrollToBottom(true);
              }}
              className="ui-pop ui-press absolute bottom-3 left-1/2 flex size-11 -translate-x-1/2 items-center justify-center rounded-pill border border-line bg-surface text-ink shadow-prompt"
            >
              <ArrowDown aria-hidden="true" className="size-5" />
            </button>
          )}
        </div>
        <SidePanel timeline={state.timeline} />
        <div className="row-start-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:col-start-1 md:row-start-2">
          <Composer disabled={!ready} onSend={sendText} onFile={sendFile} />
        </div>
      </div>
    </div>
  );
}
