'use client';

import { useId, useRef, useState } from 'react';
import { Button, InlineAlert, Tile } from '@techma/ui';
import { Check, Upload } from 'lucide-react';
import type { components } from '@techma/contracts-ts';
import { effectiveMimeTypes, formatFileSize, mimeLabels, validateFile } from '@/lib/files';

type Block = components['schemas']['Block'];
type Props = {
  block: Extract<Block, { type: 'fileRequest' }>;
  interactive: boolean;
  onFile: (file: File) => void;
};

export function FileRequestBlock({ block, interactive, onFile }: Props) {
  const [sent, setSent] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const disabled = !interactive || sent !== null;

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || disabled) return;
    const result = validateFile(file, block.acceptedMimeTypes);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSent({ name: file.name, size: file.size });
    onFile(file);
  }

  return (
    <div className="flex flex-col gap-3">
      <Tile
        tone="sun"
        className="flex flex-wrap items-center justify-between gap-5 rounded-[28px] p-7 md:p-7"
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
              {sent.name} · {formatFileSize(sent.size)}
            </span>
          </span>
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
