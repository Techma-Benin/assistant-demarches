import { Button, InlineAlert, cn } from '@techma/ui';
import { AudioLines, Check, CheckCheck, Clock, FileText, Image as ImageIcon, Loader } from 'lucide-react';
import type { TimelineEntry } from '@/lib/conversation-state';
import { formatFileSize, mimeLabel } from '@/lib/files';

export type UserEntry = Extract<TimelineEntry, { kind: 'user' }>;

export function DeliveryLine({
  entry,
  onRetry,
  align = 'end',
}: {
  entry: UserEntry;
  onRetry: () => void;
  align?: 'start' | 'end';
}) {
  const base = cn('mt-1 flex items-center gap-1 text-[13px]', align === 'end' ? 'justify-end' : 'justify-start');
  const icon = 'size-3.5 shrink-0';
  switch (entry.delivery) {
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

export function AttachmentRow({ attachment }: { attachment: NonNullable<UserEntry['attachment']> }) {
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
        <p className="text-[13px] text-ink-muted">
          {formatFileSize(attachment.sizeBytes)} · {mimeLabel(attachment.mimeType)}
        </p>
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
