import { useId, useRef, useState } from 'react';
import { Button, IconButton, InlineAlert, cn } from '@techma/ui';
import { AudioLines, Check, CheckCheck, Clock, FileText, Image as ImageIcon, Loader, Pause, Play } from 'lucide-react';
import type { Delivery, TimelineEntry } from '@/lib/conversation-state';
import { formatFileSize, mimeLabel } from '@/lib/files';
import { WAVEFORM_BARS, formatDuration } from '@/lib/voice';
import { MiddleTruncate } from './AttachmentChip';
import { ImagePreviewDialog } from './ImagePreviewDialog';

export type UserEntry = Extract<TimelineEntry, { kind: 'user' }>;

/** Splits consecutive user entries into turns: entries sharing a batchId form one turn, others stand alone. */
export function userTurns<T extends { entry: TimelineEntry }>(items: T[]): T[][] {
  const turns: T[][] = [];
  let batch: string | undefined;
  for (const item of items) {
    const id = item.entry.kind === 'user' ? item.entry.batchId : undefined;
    const last = turns[turns.length - 1];
    if (id !== undefined && id === batch && last) last.push(item);
    else turns.push([item]);
    batch = id;
  }
  return turns;
}

/** One delivery state for a whole turn; failed entries show their own error, so they are ignored here. */
export function turnDelivery(entries: UserEntry[]): Delivery | null {
  const live = entries.filter((e) => e.delivery !== 'failed' && e.delivery !== 'uploadFailed');
  if (live.length === 0) return null;
  if (live.some((e) => e.delivery === 'uploading' || e.delivery === 'sending')) return 'sending';
  if (live.some((e) => e.delivery === 'accepted')) return 'accepted';
  return 'received';
}

export function DeliveryLine({
  entry,
  onRetry,
  align = 'end',
  delivery = entry.delivery,
}: {
  entry: UserEntry;
  onRetry: () => void;
  align?: 'start' | 'end';
  /** Overrides the entry's own state (aggregated state of a turn). */
  delivery?: Delivery;
}) {
  const base = cn('mt-1 flex items-center gap-1 text-[13px]', align === 'end' ? 'justify-end' : 'justify-start');
  const icon = 'size-3.5 shrink-0';
  switch (delivery) {
    case 'sending':
      return (
        <div className={`${base} text-ink-muted`}>
          <Clock aria-hidden="true" className={icon} />
          Envoi…
        </div>
      );
    case 'accepted':
      return (
        <div className={`${base} text-ink-muted`}>
          <Check aria-hidden="true" className={icon} />
          Envoyé
        </div>
      );
    case 'received':
      return (
        <div className={`${base} text-ink-muted`}>
          <CheckCheck aria-hidden="true" className={icon} />
          Reçu
        </div>
      );
    case 'uploading':
      return (
        <div className={`${base} text-ink-muted`}>
          <Loader aria-hidden="true" className={`${icon} motion-safe:animate-spin`} />
          Envoi de la pièce…
        </div>
      );
    case 'failed':
      return (
        <div className={`${base} flex-wrap text-danger`}>
          Échec de l’envoi
          <Button variant="ghost" size="sm" className="min-h-11" onClick={onRetry}>
            Réessayer
          </Button>
        </div>
      );
    case 'uploadFailed':
      return (
        <div className={`${base} flex-wrap text-danger`}>
          {entry.error}
          {entry.retryable && (
            <Button variant="ghost" size="sm" className="min-h-11" onClick={onRetry}>
              Réessayer
            </Button>
          )}
        </div>
      );
  }
}

export function AttachmentRow({
  attachment,
  uploading,
  card,
  failed,
}: {
  attachment: NonNullable<UserEntry['attachment']>;
  uploading?: boolean;
  /** Standalone card of a turn instead of the inline row of a bubble. */
  card?: boolean;
  failed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const Icon = attachment.mimeType.startsWith('image/')
    ? ImageIcon
    : attachment.mimeType.startsWith('audio/')
      ? AudioLines
      : FileText;
  const text = (
    <div className="min-w-0 space-y-0.5">
      <MiddleTruncate
        text={attachment.name}
        className={cn('max-w-[12rem] font-semibold', card && 'text-[15px]')}
      />
      {/* A file rebuilt from the history has no size or format to show. */}
      {(uploading || attachment.sizeBytes > 0) && (
        <p className="text-[13px] text-ink-muted">
          {uploading ? 'Envoi…' : `${formatFileSize(attachment.sizeBytes)} · ${mimeLabel(attachment.mimeType)}`}
        </p>
      )}
    </div>
  );
  if (!card) {
    return (
      <div className="flex items-center gap-3">
        {uploading ? (
          <Loader aria-hidden="true" className="size-6 shrink-0 motion-safe:animate-spin" />
        ) : (
          <Icon aria-hidden="true" className="size-6 shrink-0" />
        )}
        {text}
      </div>
    );
  }
  const cardClass = cn(
    'flex min-h-14 items-center gap-3 rounded-[16px] border bg-canvas p-2 pr-4',
    failed ? 'border-danger' : 'border-border',
  );
  const thumb =
    attachment.previewUrl && !uploading ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={attachment.previewUrl} alt="" className="size-10 shrink-0 rounded-[10px] object-cover" />
    ) : (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-sunken">
        {uploading ? (
          <Loader aria-hidden="true" className="size-5 motion-safe:animate-spin" />
        ) : (
          <Icon aria-hidden="true" className="size-5" />
        )}
      </span>
    );
  if (attachment.previewUrl && !uploading) {
    return (
      <>
        <button
          type="button"
          aria-label={`Voir ${attachment.name}`}
          onClick={() => setOpen(true)}
          className={cn(
            cardClass,
            'ui-press cursor-zoom-in text-left transition-colors hover:bg-sunken/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
          )}
        >
          {thumb}
          {text}
        </button>
        {open && <ImagePreviewDialog src={attachment.previewUrl} name={attachment.name} onClose={() => setOpen(false)} />}
      </>
    );
  }
  return (
    <div className={cardClass}>
      {thumb}
      {text}
    </div>
  );
}

export const isVoice = (attachment?: UserEntry['attachment']) => !!attachment && attachment.mimeType.startsWith('audio/');

const FLAT_WAVEFORM = Array.from({ length: WAVEFORM_BARS }, () => 0.3);

/** Playable voice message: round play button, waveform, duration (current time while playing). */
export function VoiceBubble({
  attachment,
  uploading,
}: {
  attachment: NonNullable<UserEntry['attachment']>;
  uploading?: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [loadedMs, setLoadedMs] = useState(0);
  const bars = attachment.waveform?.length ? attachment.waveform : FLAT_WAVEFORM;
  const totalMs = attachment.durationMs ?? loadedMs;
  const progress = totalMs > 0 ? Math.min(1, currentMs / totalMs) : 0;
  const playedBars = Math.round(progress * bars.length);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play()?.catch(() => setPlaying(false));
    else el.pause();
  };

  return (
    <>
    <div className="flex w-[min(18rem,85vw)] items-center gap-3 rounded-[24px] bg-sunken py-2.5 pl-2.5 pr-[18px]">
      <IconButton
        variant="primary"
        label={playing ? 'Mettre en pause' : 'Écouter le message vocal'}
        onClick={toggle}
        disabled={uploading || !attachment.previewUrl}
        className="size-10"
      >
        {uploading ? (
          <Loader aria-hidden="true" className="size-5 motion-safe:animate-spin" />
        ) : playing ? (
          <Pause aria-hidden="true" className="size-5" />
        ) : (
          <Play aria-hidden="true" className="size-5" />
        )}
      </IconButton>
      <div aria-hidden="true" className="flex h-8 min-w-0 flex-1 items-center gap-[2px]">
        {bars.map((height, index) => (
          <span
            key={index}
            className={cn('w-[3px] flex-1 rounded-full', index < playedBars ? 'bg-ink' : 'bg-ink-muted')}
            style={{ height: `${Math.round(Math.max(0.08, Math.min(1, height)) * 100)}%` }}
          />
        ))}
      </div>
      <span className="shrink-0 text-[13px] tabular-nums text-ink-muted">
        {formatDuration(playing || currentMs > 0 ? currentMs : totalMs)}
      </span>
      {attachment.previewUrl && (
        <audio
          ref={audio}
          preload="metadata"
          src={attachment.previewUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setCurrentMs(0);
          }}
          onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1000)}
          onLoadedMetadata={(event) => {
            const seconds = event.currentTarget.duration;
            if (Number.isFinite(seconds)) setLoadedMs(seconds * 1000);
          }}
        />
      )}
    </div>
    {!uploading && !attachment.previewUrl && (
      <p className="m-0 mt-1 text-[13px] text-ink-muted">Écoute indisponible après rechargement</p>
    )}
    </>
  );
}

/** Transcript of a voice message under its bubble: collapsed by default; nothing when the Backend sent none. */
export function VoiceTranscript({ transcript }: { transcript: UserEntry['transcript'] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!transcript) return null;
  if (transcript.status === 'failed') return <p className="mt-1 text-[13px] text-ink-muted">Transcription indisponible</p>;
  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="min-h-11 px-1 text-[13px] font-medium text-ink-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        {open ? 'Masquer la transcription' : 'Afficher la transcription'}
      </button>
      <div id={panelId} hidden={!open} className="w-[min(18rem,85vw)]">
        {open && (
          <p className="ui-enter whitespace-pre-wrap break-words text-[15px] leading-[1.5] text-ink-muted">{transcript.text}</p>
        )}
      </div>
    </div>
  );
}

export function ErrorPanel({
  message,
  actionLabel,
  onRetry,
}: {
  message: string;
  actionLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <InlineAlert>{message}</InlineAlert>
      <Button variant="secondary" onClick={onRetry}>
        {actionLabel}
      </Button>
    </div>
  );
}
