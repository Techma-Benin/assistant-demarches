'use client';

import { useEffect, useState } from 'react';
import { IconButton, cn } from '@techma/ui';
import { FileText, X } from 'lucide-react';
import { formatFileSize } from '@/lib/files';
import { ImagePreviewDialog } from './ImagePreviewDialog';

const TAIL_LENGTH = 6;

/** File name truncated in the middle: the end (with the extension) always stays visible. Full name in `title`. */
export function MiddleTruncate({ text, className }: { text: string; className?: string }) {
  const tail = text.length > TAIL_LENGTH * 2 ? text.slice(-TAIL_LENGTH) : '';
  return (
    <span title={text} className={cn('flex min-w-0', className)}>
      <span className="truncate">{tail ? text.slice(0, -TAIL_LENGTH) : text}</span>
      {tail && <span className="shrink-0 whitespace-pre">{tail}</span>}
    </span>
  );
}

/** Object URL for a file, revoked on change/unmount. Null until created (and where unsupported). */
export function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== 'function') return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      setUrl(null);
    };
  }, [file]);
  return url;
}

function Thumbnail({ url }: { url: string | null }) {
  if (!url) return <FileText aria-hidden="true" className="size-6 shrink-0" />;
  // eslint-disable-next-line @next/next/no-img-element -- local blob preview, nothing to optimise
  return <img src={url} alt="" className="size-10 shrink-0 rounded-field object-cover" />;
}

/** A staged file: icon or thumbnail, name, size and an optional remove button. */
export function AttachmentChip({
  file,
  onRemove,
  className,
}: {
  file: File;
  onRemove?: () => void;
  className?: string;
}) {
  const isImage = file.type.startsWith('image/');
  const url = useObjectUrl(isImage ? file : null);
  const [open, setOpen] = useState(false);
  const info = (
    <>
      {isImage ? <Thumbnail url={url} /> : <FileText aria-hidden="true" className="size-6 shrink-0" />}
      <div className="min-w-0 flex-1">
        <MiddleTruncate text={file.name} className="text-[15px] font-semibold" />
        <p className="text-[13px] text-ink-muted">{formatFileSize(file.size)}</p>
      </div>
    </>
  );
  return (
    <div
      className={cn(
        'ui-pop flex min-h-12 items-center gap-3 rounded-field bg-sunken py-1 pl-3 pr-1 text-left text-ink',
        className,
      )}
    >
      {isImage ? (
        <button
          type="button"
          aria-label={`Voir ${file.name}`}
          onClick={() => setOpen(true)}
          className="ui-press flex min-w-0 flex-1 cursor-zoom-in items-center gap-3 rounded-field text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {info}
        </button>
      ) : (
        info
      )}
      {onRemove && (
        <IconButton label={`Retirer ${file.name}`} onClick={onRemove}>
          <X className="size-5" aria-hidden="true" />
        </IconButton>
      )}
      {open && url && <ImagePreviewDialog src={url} name={file.name} onClose={() => setOpen(false)} />}
    </div>
  );
}
