'use client';

import { useId, useRef, useState, type DragEvent } from 'react';
import { Button, InlineAlert, Tile, cn } from '@techma/ui';
import { Check, Upload } from 'lucide-react';
import type { components } from '@techma/contracts-ts';
import { AttachmentChip } from '@/components/chat/AttachmentChip';
import { fileKey, MAX_STAGED_FILES, useStagedFiles } from '@/hooks/use-staged-files';
import { effectiveMimeTypes, formatFileSize, mimeLabels } from '@/lib/files';

type Block = components['schemas']['Block'];
type Props = {
  block: Extract<Block, { type: 'fileRequest' }>;
  interactive: boolean;
  onFiles: (files: File[]) => void;
};

export function FileRequestBlock({ block, interactive, onFiles }: Props) {
  const [sent, setSent] = useState<{ name: string; size: number }[] | null>(null);
  const { files: staged, error, add, remove, clear } = useStagedFiles(block.acceptedMimeTypes);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const disabled = !interactive || sent !== null;

  function stage(list: File[]) {
    if (disabled) return;
    add(list);
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(event.target.files ?? []);
    event.target.value = '';
    stage(list);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (disabled || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setDragging(true);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    stage(Array.from(event.dataTransfer.files));
  }

  function submit() {
    if (staged.length === 0 || disabled) return;
    setSent(staged.map((file) => ({ name: file.name, size: file.size })));
    onFiles(staged);
    clear();
  }

  return (
    <div className="flex flex-col gap-3">
      <Tile
        tone="sun"
        className={cn(
          'flex flex-wrap items-center justify-between gap-5 rounded-[28px] p-7 md:p-7',
          dragging && 'outline-2 outline-dashed outline-offset-2 outline-ink',
        )}
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={handleDrop}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="m-0 break-words font-display text-[28px] font-extrabold tracking-[-0.035em]">{block.label}</h2>
          <p className="m-0 text-[15px]">
            {mimeLabels(effectiveMimeTypes(block.acceptedMimeTypes))} · stockée à part, jamais dans la conversation
          </p>
        </div>
        <label htmlFor={inputId} className="sr-only">
          Joindre une pièce
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          accept={effectiveMimeTypes(block.acceptedMimeTypes).join(',')}
          disabled={disabled}
          onChange={handleChange}
        />
        {sent ? (
          <span className="inline-flex min-w-0 items-center gap-2.5 rounded-pill bg-surface px-[18px] py-3 text-[15px] font-semibold text-ink">
            <Check aria-hidden="true" className="size-[18px] shrink-0 text-trust-text" strokeWidth={2.6} />
            <span className="min-w-0 break-all">
              {sent.map((item) => `${item.name} · ${formatFileSize(item.size)}`).join(', ')}
            </span>
          </span>
        ) : staged.length > 0 ? (
          <div className="flex w-full flex-col gap-3">
            <div className="flex flex-col gap-2">
              {staged.map((file) => (
                <AttachmentChip key={fileKey(file)} file={file} onRemove={() => remove(file)} className="bg-surface" />
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                size="lg"
                disabled={disabled || staged.length >= MAX_STAGED_FILES}
                className="min-h-[52px] px-6 font-bold"
                onClick={() => inputRef.current?.click()}
              >
                Ajouter une autre pièce
              </Button>
              <Button size="lg" disabled={disabled} className="min-h-[52px] px-6 font-bold" onClick={submit}>
                {staged.length === 1 ? 'Envoyer cette pièce' : 'Envoyer les pièces'}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="lg"
            disabled={disabled}
            className="min-h-[52px] px-6 font-bold"
            leadingIcon={<Upload aria-hidden="true" className="size-[18px]" strokeWidth={2.4} />}
            onClick={() => inputRef.current?.click()}
          >
            Choisir un fichier
          </Button>
        )}
      </Tile>
      {error && <InlineAlert>{error}</InlineAlert>}
    </div>
  );
}
