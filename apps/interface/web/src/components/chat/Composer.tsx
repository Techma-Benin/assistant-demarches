'use client';

import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Loader, Mic, Trash2 } from 'lucide-react';
import { IconButton, InlineAlert, PromptBox, VisuallyHidden, cn } from '@techma/ui';
import { CONTRACT_MIME_TYPES, MAX_FILE_BYTES, mimeLabel, validateFile } from '@/lib/files';
import { fileKey, useStagedFiles } from '@/hooks/use-staged-files';
import { useVoiceRecorder } from '@/hooks/use-voice-recorder';
import { formatDuration } from '@/lib/voice';
import { AttachmentChip } from './AttachmentChip';

type Props = {
  disabled: boolean;
  onSend: (text: string) => void;
  onFiles: (files: File[], note?: string, voice?: { durationMs: number; waveform: number[] }) => void;
  variant?: 'compact' | 'hero';
  label?: string;
  placeholder?: string;
  /** Controlled text; the composer keeps its own when absent. */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Show the accepted-formats line and the length counter. */
  hint?: boolean;
  /** Shared staged files (e.g. between two composers); the composer stages its own when absent. */
  staged?: ReturnType<typeof useStagedFiles>;
  className?: string;
};

const METER_BARS = 24;
const METER_EVERY_MS = 80;
const MAX_LENGTH = 4000;
const COUNTER_FROM = 3600;
const counterFormat = new Intl.NumberFormat('fr-FR');

// Documents and images from the contract list (audio is not advertised here).
const HINT_LABELS = CONTRACT_MIME_TYPES.filter((mime) => !mime.startsWith('audio/')).map((mime) =>
  mime === 'image/jpeg' ? 'JPG' : mimeLabel(mime),
);
const HINT = `${HINT_LABELS.slice(0, -1).join(', ')} ou ${HINT_LABELS[HINT_LABELS.length - 1]} · ${MAX_FILE_BYTES / 1024 / 1024} Mo maximum`;

/** Live input level: the last 24 levels as thin bars, scaled with transform only. */
function LevelMeter({ level }: { level: number }) {
  const [levels, setLevels] = useState<number[]>(() => Array(METER_BARS).fill(0));
  const last = useRef(0);
  useEffect(() => {
    const now = performance.now();
    if (now - last.current < METER_EVERY_MS) return;
    last.current = now;
    setLevels((previous) => [...previous.slice(1), level]);
  }, [level]);
  return (
    <div aria-hidden="true" className="flex h-6 min-w-0 flex-1 items-center gap-[3px]">
      {levels.map((value, index) => (
        <span
          key={index}
          className="h-full w-[3px] origin-center rounded-full bg-ink"
          style={{ transform: `scaleY(${Math.max(0.12, Math.min(1, value))})` }}
        />
      ))}
    </div>
  );
}

export function Composer({
  disabled,
  onSend,
  onFiles,
  variant = 'compact',
  label = 'Votre message',
  placeholder = 'Écrire un message…',
  value,
  onValueChange,
  hint = true,
  staged,
  className,
}: Props) {
  const [innerText, setInnerText] = useState('');
  const text = value ?? innerText;
  const setText = (next: string) => {
    if (value === undefined) setInnerText(next);
    onValueChange?.(next);
  };
  const ownStaged = useStagedFiles(CONTRACT_MIME_TYPES);
  const { files, error: fileError, add, remove, clear } = staged ?? ownStaged;
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const sendVoiceRef = useRef<() => void>(() => {});
  const voice = useVoiceRecorder({ onMaxReached: () => sendVoiceRef.current() });
  const recording = voice.status === 'recording';
  const wasRecording = useRef(false);

  useEffect(() => {
    if (recording) root.current?.querySelector<HTMLElement>('button[aria-label="Envoyer le message vocal"]')?.focus();
    else if (wasRecording.current) {
      const target =
        root.current?.querySelector<HTMLElement>('button[aria-label="Enregistrer un message vocal"]') ??
        root.current?.querySelector<HTMLElement>('textarea');
      target?.focus();
    }
    wasRecording.current = recording;
  }, [recording]);

  async function sendVoice() {
    if (sending.current) return;
    sending.current = true;
    try {
      const result = await voice.finish();
      if (result) onFiles([result.file], undefined, { durationMs: result.durationMs, waveform: result.waveform });
    } finally {
      sending.current = false;
    }
  }
  sendVoiceRef.current = () => void sendVoice();

  function handleRecordingKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      voice.cancel();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void sendVoice();
    }
  }

  function stage(list: File[]) {
    if (disabled || recording) return;
    add(list);
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(event.target.files ?? []);
    event.target.value = '';
    stage(list);
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const list = Array.from(event.clipboardData.files);
    if (list.length === 0) return;
    event.preventDefault();
    stage(list);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    stage(Array.from(event.dataTransfer.files));
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (disabled || recording || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  }

  const counting = text.length > COUNTER_FROM;

  const alert = voice.error ?? fileError;
  const micButton = voice.supported ? (
    <IconButton
      variant="primary"
      label="Enregistrer un message vocal"
      onClick={() => void voice.start()}
      disabled={disabled || voice.status === 'requesting'}
      className="size-12"
    >
      {voice.status === 'requesting' ? (
        <Loader className="size-5 motion-safe:animate-spin" aria-hidden="true" />
      ) : (
        <Mic className="size-5" aria-hidden="true" />
      )}
    </IconButton>
  ) : undefined;

  return (
    <div ref={root}>
      {alert && <InlineAlert className="mb-2">{alert}</InlineAlert>}
      <input
        ref={fileInput}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={CONTRACT_MIME_TYPES.join(',')}
        disabled={disabled || recording}
        onChange={handleFile}
      />
      <div
        className="relative"
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {recording ? (
          <div
            onKeyDown={handleRecordingKey}
            className="ui-enter flex items-center gap-2 rounded-[28px] border border-line-strong bg-surface py-2.5 pl-2.5 pr-2.5 shadow-prompt sm:pl-3"
          >
            <VisuallyHidden role="status">Enregistrement…</VisuallyHidden>
            <IconButton label="Supprimer l’enregistrement" onClick={() => voice.cancel()}>
              <Trash2 className="size-5" aria-hidden="true" />
            </IconButton>
            <div className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-2">
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-danger motion-safe:animate-pulse" />
              <span className="shrink-0 text-base tabular-nums text-ink">{formatDuration(voice.elapsedMs)}</span>
              <LevelMeter level={voice.level} />
            </div>
            <IconButton
              variant="primary"
              label="Envoyer le message vocal"
              onClick={() => void sendVoice()}
              className="size-12"
            >
              <ArrowUp className="size-5" strokeWidth={2.5} aria-hidden="true" />
            </IconButton>
          </div>
        ) : (
        <PromptBox
          idleAction={micButton}
          variant={variant}
          label={label}
          placeholder={placeholder}
          value={text}
          onValueChange={(next) => setText(next.slice(0, MAX_LENGTH))}
          disabled={disabled}
          onAttach={() => fileInput.current?.click()}
          canSubmit={files.length > 0}
          attachment={
            files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {files.map((file) => (
                  <AttachmentChip key={fileKey(file)} file={file} onRemove={() => remove(file)} className="max-w-full sm:max-w-[16rem]" />
                ))}
              </div>
            )
          }
          onSubmit={(value) => {
            if (files.length > 0) {
              onFiles(files, value || undefined);
              clear();
            } else {
              onSend(value);
            }
            setText('');
          }}
          className={cn('shadow-prompt', dragging && 'border-dashed border-ink', className)}
        />
        )}
        {dragging && (
          <div
            aria-hidden="true"
            className="ui-pop pointer-events-none absolute inset-0 flex items-center justify-center rounded-[28px] border-2 border-dashed border-ink bg-surface/90 text-[15px] font-semibold text-ink"
          >
            Déposez vos pièces ici
          </div>
        )}
      </div>
      {hint && (
        <div className="mt-2 flex items-start justify-between gap-3 px-2 text-[13px] text-ink-muted">
          <p>{HINT}</p>
          {counting && (
            <p aria-live="polite" className={cn('shrink-0', text.length >= MAX_LENGTH && 'font-semibold text-warning')}>
              {counterFormat.format(text.length)} / {counterFormat.format(MAX_LENGTH)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
