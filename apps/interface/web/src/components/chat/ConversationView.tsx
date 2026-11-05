'use client';

import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { BrandMark, Button, Chip, FlagGlyph, InlineAlert, SourceList, ThemeToggle, TypingIndicator, cn } from '@techma/ui';
import { ArrowDown, Plus } from 'lucide-react';
import { AccountMenu } from '@/components/app/AccountMenu';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import { useThreadScroll } from '@/hooks/use-thread-scroll';
import { useUnreadTitle } from '@/hooks/use-unread-title';
import type { FollowUp, useConversation } from '@/hooks/use-conversation';
import { formInteraction } from '@/lib/interactions';
import { WAITING_LABEL, type TimelineEntry } from '@/lib/conversation-state';
import { fileRequestKey, latestFileRequestSlots, latestRequest, lastTextSources, openFileRequests, receivedFileRequests, toSourceInfo, type DraftRequest } from '@/lib/dossier';
import { dayKey, formatDayLabel, formatTime } from '@/lib/format-time';
import { revealDelays } from '@/lib/reveal';
import { TextBlock } from '@/components/blocks/TextBlock';
import { AgentActivity } from './AgentActivity';
import { Composer } from './Composer';
import { CONTRACT_MIME_TYPES } from '@/lib/files';
import { fileKey, useStagedFiles } from '@/hooks/use-staged-files';
import { ConnectionNotice } from './ConnectionNotice';
import { DossierSheet } from './DossierSheet';
import { MessageActions } from './MessageActions';
import { RequestPanel } from './RequestPanel';
import { RestartDialog } from './RestartDialog';
import { AttachmentRow, DeliveryLine, ErrorPanel, VoiceBubble, VoiceTranscript, isVoice, turnDelivery, userTurns, type UserEntry } from './UserEntryParts';

const SUGGESTIONS = ['Quelles démarches pouvez-vous m’expliquer ?', 'Comment ça marche ?'];

const PANEL_TITLE = 'font-display text-[20px] font-extrabold tracking-[-0.03em]';

type Conversation = ReturnType<typeof useConversation>;


/** « Vos informations » + sources panels, shared by the wide-screen side panel, the right drawer and the phone bottom sheet. */
function DossierPanels({ request, sources }: { request: DraftRequest | null; sources: ReturnType<typeof toSourceInfo>[] }) {
  const id = useId();
  return (
    <>
      {request !== null && <RequestPanel request={request} titleClassName={PANEL_TITLE} />}
      {sources.length > 0 && (
        <section aria-labelledby={`${id}-sources`} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
          <h2 id={`${id}-sources`} className={PANEL_TITLE}>
            Sources
          </h2>
          <SourceList sources={sources} />
        </section>
      )}
    </>
  );
}

/** Wide screens only: lives in the right gutter, outside the centred thread column, and never pushes it. */
function SidePanel({ request, sources }: { request: DraftRequest | null; sources: ReturnType<typeof toSourceInfo>[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 hidden min-[1440px]:block">
      <aside className="ui-scrollbar-none pointer-events-auto absolute right-6 top-8 flex max-h-[calc(100%-4rem)] w-[300px] flex-col gap-4 overflow-y-auto">
        <DossierPanels request={request} sources={sources} />
      </aside>
    </div>
  );
}

/** Tracks a CSS media query (false until mounted and where `matchMedia` is missing). */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

type Group = { kind: TimelineEntry['kind']; items: { entry: TimelineEntry; index: number }[] };

/** Consecutive entries from the same sender form a group. */
function groupEntries(timeline: TimelineEntry[]): Group[] {
  const groups: Group[] = [];
  timeline.forEach((entry, index) => {
    const last = groups.at(-1);
    if (last && last.kind === entry.kind) last.items.push({ entry, index });
    else groups.push({ kind: entry.kind, items: [{ entry, index }] });
  });
  return groups;
}

const entryDate = (entry: TimelineEntry) => (entry.kind === 'agent' ? entry.message.createdAt : entry.sentAt);

/** Day labels to show before some groups (by index): only when the chat spans several days or starts before today. */
function daySeparators(groups: Group[], now: Date): Map<number, string> {
  const labels = new Map<number, string>();
  const keys = groups.map((group) => dayKey(entryDate(group.items[0].entry)));
  const known = keys.filter(Boolean);
  if (known.length === 0) return labels;
  if (new Set(known).size === 1 && known[0] === dayKey(now.toISOString())) return labels;
  let previous = '';
  keys.forEach((key, index) => {
    if (!key || key === previous) return;
    previous = key;
    labels.set(index, formatDayLabel(entryDate(groups[index].items[0].entry), now));
  });
  return labels;
}

const entryId = (entry: TimelineEntry) => (entry.kind === 'agent' ? entry.message.id : entry.id);

/** True when closing the conversation would lose something worth confirming (form, file, draft, case). */
function holdsDossier(state: Conversation['state']): boolean {
  const formIds = new Set(
    state.timeline.flatMap((e) => (e.kind === 'agent' ? e.message.blocks.flatMap((b) => (b.type === 'form' ? [b.id] : [])) : [])),
  );
  return state.timeline.some((e) =>
    e.kind === 'agent'
      ? e.message.blocks.some((b) => b.type === 'requestCard' || b.type === 'caseCard')
      : e.attachment !== undefined || (e.content?.type === 'interaction' && formIds.has(e.content.actionId)),
  );
}

function Time({ iso, className }: { iso: string; className?: string }) {
  const text = formatTime(iso);
  if (!text) return null;
  return (
    <time dateTime={iso} className={cn('text-[13px] text-ink-muted', className)}>
      {text}
    </time>
  );
}

export function ConversationView({
  conversation,
  onRestart,
  onHome,
  embedded = false,
}: {
  conversation: Conversation;
  onRestart: () => void;
  /** Inside an iframe (`/embed`): the brand link opens the site in a new tab instead of replacing the chat. */
  embedded?: boolean;
  /** Back to the home page; the conversation stays saved. */
  onHome?: () => void;
}) {
  const { state, connection, loadingHistory, sendText, sendButton, sendForm, sendFiles, retry, consent } = conversation;
  // Files chosen from a request card wait in the composer; each keeps the line it answers.
  const staged = useStagedFiles(CONTRACT_MIME_TYPES);
  const stagedFor = useRef(new Map<string, { slot: string; documentType: string }>());
  const [sentFor, setSentFor] = useState<Map<string, { name: string; size: number }>>(new Map());
  const composerRef = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const pendingFor = new Map<string, { name: string; size: number }>();
  for (const file of staged.files) {
    const link = stagedFor.current.get(fileKey(file));
    if (link) pendingFor.set(link.slot, { name: file.name, size: file.size });
  }
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const drawerSide = useMediaQuery('(min-width: 768px)') ? 'right' : 'bottom';
  // From 1440px the panel sits in the gutter: a drawer left open would stay modal while hidden.
  const panelInGutter = useMediaQuery('(min-width: 1440px)');
  useEffect(() => {
    if (panelInGutter) setSheetOpen(false);
  }, [panelInGutter]);
  // Forget links of files removed from the staging area.
  useEffect(() => {
    const keys = new Set(staged.files.map(fileKey));
    for (const key of stagedFor.current.keys()) if (!keys.has(key)) stagedFor.current.delete(key);
  }, [staged.files]);

  function stageForRequest(files: File[], block: { requestId: string; documentType: string }) {
    for (const file of files) stagedFor.current.set(fileKey(file), { slot: fileRequestKey(block), documentType: block.documentType });
    staged.add(files);
    setFocusRequest((n) => n + 1);
  }
  // Focus once the card input is disabled, or the browser would drop the focus on the body.
  useEffect(() => {
    if (focusRequest > 0) composerRef.current?.querySelector<HTMLElement>('textarea')?.focus();
  }, [focusRequest]);

  // One send per requested document: the text goes with the last group.
  // `followUp` (a form answer) goes after the last file, as the text does.
  function sendStaged(
    files: File[],
    note?: string,
    voice?: { durationMs: number; waveform: number[] },
    followUp?: FollowUp,
  ) {
    const groups = new Map<string | null, File[]>();
    for (const file of files) {
      const type = stagedFor.current.get(fileKey(file))?.documentType ?? null;
      groups.set(type, [...(groups.get(type) ?? []), file]);
    }
    const sentNow = new Map(sentFor);
    for (const file of files) {
      const link = stagedFor.current.get(fileKey(file));
      if (link) sentNow.set(link.slot, { name: file.name, size: file.size });
    }
    const entries = [...groups];
    entries.forEach(([type, group], i) => {
      const last = i === entries.length - 1;
      const args = [group, last ? note : undefined, last ? voice : undefined, type] as const;
      if (last && followUp) sendFiles(...args, followUp);
      else sendFiles(...args);
    });
    for (const file of files) stagedFor.current.delete(fileKey(file));
    setSentFor(sentNow);
  }

  // « Continuer » also sends the files waiting in the composer; the composer text stays in its field.
  function submitForm(formId: string, values: Record<string, string>, summary: string) {
    if (staged.files.length === 0) {
      sendForm(formId, values, summary);
      return;
    }
    sendStaged(staged.files, undefined, undefined, { content: formInteraction(formId, values), display: summary });
    staged.clear();
  }

  // Entries present at mount are history: they never animate. Only what arrives afterwards is "live".
  const [seenAtMount] = useState(() => new Set(state.timeline.map(entryId)));

  const last = state.timeline[state.timeline.length - 1];
  const { scrollRef, contentRef, onScroll, atBottom, jumpToLatest } = useThreadScroll(
    last ? { key: entryId(last), kind: last.kind === 'user' ? 'user' : 'agent' } : null,
  );
  // Waiting for an answer: after a user message, or once the visitor accepted the consent the agent was waiting for.
  const lastBlock = last?.kind === 'agent' ? last.message.blocks.at(-1) : undefined;
  const drafts = state.drafts ?? [];
  const waitingForAgent =
    drafts.length === 0 &&
    ((last?.kind === 'user' && (last.delivery === 'accepted' || last.delivery === 'received')) ||
    (lastBlock?.type === 'consent' && consent.states[lastBlock.challenge.id]?.phase === 'accepted'));
  const label = WAITING_LABEL;

  let lastAgentIndex = -1;
  let agentCount = 0;
  state.timeline.forEach((entry, index) => {
    if (entry.kind !== 'agent') return;
    lastAgentIndex = index;
    agentCount += 1;
  });
  useUnreadTitle(agentCount);
  const firstQuestion = state.timeline.find((entry) => entry.kind === 'user' && !entry.attachment);
  const title = firstQuestion?.kind === 'user' ? firstQuestion.display : null;

  const request = latestRequest(state.timeline);
  // A requested document stays addable from its own line while it is missing, on its most recent block only.
  const openRequests = openFileRequests(state.timeline);
  const receivedRequests = receivedFileRequests(state.timeline);
  const requestSlots = latestFileRequestSlots(state.timeline);
  // A form of the last agent message can still be submitted: it sends the staged files too.
  const lastAgent = state.timeline[lastAgentIndex];
  const formActive = lastAgent?.kind === 'agent' && lastAgent.message.blocks.some((b) => b.type === 'form');
  const sources = lastTextSources(state.timeline).map((source, index) => toSourceInfo(source, index, true));
  const panelLabel = request !== null ? 'Vos informations' : sources.length > 0 ? `Sources (${sources.length})` : null;

  const ready = state.status === 'ready';
  // No conversation yet is fine: it is created by the first message.
  const canSend = state.status !== 'error';

  const restart = () => {
    if (holdsDossier(state)) setConfirmingRestart(true);
    else onRestart();
  };

  const header = (
    <header className="shrink-0 border-b border-line-subtle">
      <div className="mx-auto flex max-w-[1320px] items-center gap-x-3 px-4 py-3 md:px-6 md:py-4">
        <a
          href="/"
          aria-label="Accueil"
          {...(embedded ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          onClick={(event) => {
            if (!onHome || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault();
            onHome();
          }}
          className="shrink-0 rounded-pill no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <BrandMark />
        </a>
        <p className="m-0 hidden min-w-0 flex-1 truncate text-base font-semibold text-ink-muted min-[480px]:block" title={title ?? undefined}>
          {title}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {panelLabel !== null && (
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="ui-press inline-flex min-h-11 items-center whitespace-nowrap rounded-pill border border-line bg-surface px-4 text-sm font-semibold text-ink transition-[background-color,transform] duration-(--ui-dur-press) ease-(--ui-ease-out) hover:bg-sunken min-[1440px]:hidden"
            >
              {panelLabel}
            </button>
          )}
          <Button
            variant="secondary"
            onClick={restart}
            aria-label="Nouvelle question"
            className="max-sm:size-12 max-sm:px-0"
            leadingIcon={<Plus aria-hidden="true" className="size-4" strokeWidth={2.6} />}
          >
            {/* Icon only on phones so the header stays on one line. */}
            <span className="max-sm:sr-only">Nouvelle question</span>
          </Button>
          {!embedded && <AccountMenu />}
          {/* Phones follow the system theme: one line of header matters more than the toggle there. */}
          <ThemeToggle className="max-sm:hidden" />
        </div>
      </div>
    </header>
  );

  // An error before any message is a blank panel; once there is history, the history stays and the notice follows it.
  if (state.status === 'error' && state.timeline.length === 0) {
    return (
      <div className="flex min-h-dvh flex-col bg-canvas text-ink">
        {header}
        <ErrorPanel
          message={state.error ?? 'Une erreur est survenue.'}
          actionLabel={state.lost ? 'Nouvelle conversation' : 'Réessayer'}
          onRetry={onRestart}
        />
        {confirmingRestart && <RestartDialog onCancel={() => setConfirmingRestart(false)} onConfirm={onRestart} />}
      </div>
    );
  }

  const groups = groupEntries(state.timeline);
  const separators = daySeparators(groups, new Date());

  // Chat layout: the page never scrolls. Header and composer stay put; one full-width region scrolls, so its
  // scrollbar sits at the window edge. Thread and composer share one centred 760px column. From 1440px the
  // side panel floats in the right gutter; below, a header button opens it in a right drawer (md) or a bottom sheet.
  const column = 'mx-auto w-full max-w-[760px] px-4 md:px-6';
  // The root is `relative` so visually hidden (absolute) inputs stay clipped instead of extending the page scroll.
  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-canvas text-ink">
      {header}
      {ready && (
        <div className="shrink-0">
          <ConnectionNotice connection={connection} />
        </div>
      )}
      {/* One announcement of what the agent is doing, outside the log so live regions never nest. */}
      {waitingForAgent && (
        <div role="status" className="sr-only">
          {label}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        // relative: absolutely positioned descendants (sr-only live regions) stay inside the scroll box
        // instead of overflowing the overflow-hidden page, which focus could then scroll.
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-color:var(--ui-border-strong)_transparent] [scrollbar-gutter:stable]"
      >
        <div className={column}>
          <main ref={contentRef} className="flex min-w-0 flex-col gap-7 pb-6 pt-6 [overflow-anchor:auto] md:pt-8">
            <h1 className="sr-only">Conversation avec l’Assistant Démarches</h1>
            <p className="m-0 text-center text-[13px] text-ink-muted">
              L’IA peut se tromper. Vérifiez les informations importantes sur le portail officiel.
            </p>
            {(state.status === 'starting' || loadingHistory) && state.timeline.length === 0 && (
              <div className="flex items-center gap-2 text-ink-muted">
                <TypingIndicator label="Connexion…" />
                <span aria-hidden="true">Connexion…</span>
              </div>
            )}
            {canSend && !loadingHistory && state.status !== 'starting' && state.timeline.length === 0 && (
              <div className="flex flex-col gap-4">
                <h2 className="m-0 font-display text-[clamp(36px,4.4vw,56px)] font-extrabold leading-none tracking-[-0.045em]">
                  Bonjour !
                </h2>
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
              {groups.map((group, groupIndex) => (
                <Fragment key={entryId(group.items[0].entry)}>
                {separators.has(groupIndex) && (
                  <div role="separator" className="flex items-center gap-3 text-[13px] font-medium text-ink-muted">
                    <span aria-hidden="true" className="h-px flex-1 bg-line" />
                    <span>{separators.get(groupIndex)}</span>
                    <span aria-hidden="true" className="h-px flex-1 bg-line" />
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {group.kind === 'agent' && group.items[0].entry.kind === 'agent' && (
                    <div data-group-header className="flex items-center gap-2">
                      <FlagGlyph decorative width={22} height={16} className="shrink-0" />
                      <span className="text-[14px] font-semibold text-ink">Assistant Démarches</span>
                      <Time iso={group.items[0].entry.message.createdAt} />
                    </div>
                  )}
                  {group.kind === 'user' &&
                    userTurns(group.items).map((turn, turnIndex, turns) => {
                      const entries = turn.flatMap(({ entry }) => (entry.kind === 'user' ? [entry] : []));
                      const first = entries[0];
                      if (!first) return null;
                      const live = !seenAtMount.has(first.id);
                      const isLast = turnIndex === turns.length - 1;
                      const retryEntry = (entry: UserEntry) => () => retry(entry.id);
                      if (first.batchId === undefined) {
                        return (
                          <div key={first.id} data-entry-id={first.id} data-turn className={cn('flex flex-col items-end', live && 'ui-enter')}>
                            {isVoice(first.attachment) ? (
                              <>
                                <VoiceBubble attachment={first.attachment!} uploading={first.delivery === 'uploading'} />
                                <VoiceTranscript transcript={first.transcript} />
                              </>
                            ) : (
                              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[24px] bg-sunken px-[22px] py-3.5 text-[17px] font-medium">
                                {first.attachment ? (
                                  <>
                                    <AttachmentRow attachment={first.attachment} uploading={first.delivery === 'uploading'} />
                                    {/* Text of the message under its attachment (e.g. a transcript), unless it is just the file name. */}
                                    {first.display !== '' && first.display !== first.attachment.name && (
                                      <p className="m-0 mt-2">{first.display}</p>
                                    )}
                                  </>
                                ) : (
                                  first.display
                                )}
                              </div>
                            )}
                            {isLast ? (
                              <div className="flex items-start justify-end gap-2">
                                <Time iso={first.sentAt} className="mt-1" />
                                <DeliveryLine entry={first} onRetry={retryEntry(first)} />
                              </div>
                            ) : (
                              <DeliveryLine entry={first} onRetry={retryEntry(first)} />
                            )}
                          </div>
                        );
                      }
                      const cards = entries.filter((e) => e.attachment);
                      const notes = entries.filter((e) => !e.attachment);
                      const aggregated = turnDelivery(entries);
                      return (
                        <div key={first.id} data-turn className={cn('flex flex-col items-end gap-2', live && 'ui-enter')}>
                          {cards.length > 0 && (
                            <div
                              role="group"
                              aria-label={cards.length === 1 ? '1 pièce jointe' : `${cards.length} pièces jointes`}
                              className="flex max-w-[85%] flex-wrap justify-end gap-2"
                            >
                              {cards.map((entry) => {
                                const failed = entry.delivery === 'failed' || entry.delivery === 'uploadFailed';
                                return (
                                  <div key={entry.id} data-entry-id={entry.id} className="flex flex-col items-end">
                                    {isVoice(entry.attachment) ? (
                                      <>
                                        <VoiceBubble attachment={entry.attachment!} uploading={entry.delivery === 'uploading'} />
                                        <VoiceTranscript transcript={entry.transcript} />
                                      </>
                                    ) : (
                                      <AttachmentRow
                                        card
                                        attachment={entry.attachment!}
                                        uploading={entry.delivery === 'uploading'}
                                        failed={failed}
                                      />
                                    )}
                                    {failed && <DeliveryLine entry={entry} onRetry={retryEntry(entry)} />}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {notes.map((entry) => (
                            <div key={entry.id} data-entry-id={entry.id} className="flex max-w-[85%] flex-col items-end">
                              <div className="whitespace-pre-wrap break-words rounded-[24px] bg-sunken px-[22px] py-3.5 text-[17px] font-medium">
                                {entry.display}
                              </div>
                              {entry.delivery === 'failed' && <DeliveryLine entry={entry} onRetry={retryEntry(entry)} />}
                            </div>
                          ))}
                          {(isLast || aggregated) && (
                            <div className="flex items-start justify-end gap-2">
                              {isLast && <Time iso={first.sentAt} className="mt-1" />}
                              {aggregated && <DeliveryLine entry={first} delivery={aggregated} onRetry={retryEntry(first)} />}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  {group.items.map(({ entry, index }, position) => {
                    const live = !seenAtMount.has(entryId(entry));
                    if (entry.kind === 'agent') {
                      const delays = live ? revealDelays(entry.message.blocks) : null;
                      // Successive replies sit apart (group gap + 32px, about twice the gap inside a reply) so a source never reads as the next reply's.
                      return (
                        <div
                          key={entry.message.id}
                          data-entry-id={entry.message.id}
                          className={cn('group flex flex-col gap-[22px]', position > 0 && 'mt-8')}
                        >
                          {entry.message.blocks.map((block, blockIndex) => (
                            <BlockRenderer
                              key={blockIndex}
                              block={block}
                              interactive={index === lastAgentIndex}
                              fileRequestActive={
                                block.type === 'fileRequest' &&
                                openRequests.has(fileRequestKey(block)) &&
                                requestSlots.get(fileRequestKey(block)) === `${index}:${blockIndex}`
                              }
                              fileRequestReceived={block.type === 'fileRequest' && receivedRequests.has(fileRequestKey(block))}
                              onButton={sendButton}
                              onForm={submitForm}
                              fileRequestPending={block.type === 'fileRequest' ? pendingFor.get(fileRequestKey(block)) : undefined}
                              fileRequestFormActive={formActive}
                              fileRequestSent={block.type === 'fileRequest' ? sentFor.get(fileRequestKey(block)) : undefined}
                              onFiles={(files) => block.type === 'fileRequest' && stageForRequest(files, block)}
                              consent={consent}
                              conversationId={state.conversationId}
                              revealDelay={delays?.[blockIndex]}
                            />
                          ))}
                          <div className="-mt-3.5 -ml-2.5">
                            <MessageActions message={entry.message} alwaysVisible={index === lastAgentIndex} />
                          </div>
                                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
                </Fragment>
              ))}
              {state.status === 'error' && (
                <div className="flex flex-col items-center gap-4 text-center">
                  <InlineAlert>{state.error ?? 'Une erreur est survenue.'}</InlineAlert>
                  <Button variant="secondary" onClick={onRestart}>
                    {state.lost ? 'Nouvelle conversation' : 'Réessayer'}
                  </Button>
                </div>
              )}
              {drafts.map((draft, position) => (
                <div
                  key={draft.messageId}
                  data-entry-id={draft.messageId}
                  data-live-draft
                  aria-busy="true"
                  aria-live="off"
                  className={cn('flex flex-col gap-2', position === 0 && last?.kind === 'agent' && 'mt-1')}
                >
                  {!(position === 0 && last?.kind === 'agent') && (
                    <div className="flex items-center gap-2">
                      <FlagGlyph decorative width={22} height={16} className="shrink-0" />
                      <span className="text-[14px] font-semibold text-ink">Assistant Démarches</span>
                    </div>
                  )}
                  <TextBlock block={{ type: 'text', text: draft.text, sources: [] }} revealDelay={0} live />
                </div>
              ))}
              {waitingForAgent && <AgentActivity label={label} />}
            </div>
          </main>
        </div>
      </div>
      <SidePanel request={request} sources={sources} />
      </div>
      <div className="relative shrink-0">
        {/* Fade over the thread and the jump button, both aligned on the thread column. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-full h-16 overflow-y-hidden [scrollbar-gutter:stable]">
          <div className="absolute inset-x-0 bottom-0 h-6 bg-linear-to-t from-canvas to-transparent" />
          <div className={cn(column, 'flex h-full items-end')}>
            <div className="flex w-full justify-center pb-3">
              <button
                type="button"
                aria-label="Aller au dernier message"
                aria-hidden={atBottom}
                tabIndex={atBottom ? -1 : 0}
                onClick={jumpToLatest}
                className={cn(
                  'ui-press pointer-events-auto flex size-11 items-center justify-center rounded-pill bg-action text-on-action shadow-prompt transition-[opacity,transform] duration-150 ease-(--ui-ease-out) motion-reduce:transition-none',
                  atBottom ? 'pointer-events-none scale-95 opacity-0' : 'scale-100 opacity-100',
                )}
              >
                <ArrowDown aria-hidden="true" className="size-5" />
              </button>
            </div>
          </div>
        </div>
        <div className="overflow-y-hidden [scrollbar-gutter:stable]">
          <div className={column}>
            <div className="pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              <div ref={composerRef}>
                <Composer disabled={!canSend} onSend={sendText} onFiles={sendStaged} staged={staged} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <DossierSheet side={drawerSide} label={request !== null ? 'Vos informations' : 'Sources'} open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <DossierPanels request={request} sources={sources} />
      </DossierSheet>
      {confirmingRestart && <RestartDialog onCancel={() => setConfirmingRestart(false)} onConfirm={onRestart} />}
    </div>
  );
}
