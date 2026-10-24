'use client';

import { useId, useRef, useState } from 'react';
import { Button, Card, InlineAlert } from '@techma/ui';
import { FileUp } from 'lucide-react';
import type { components } from '@techma/contracts-ts';
import { effectiveMimeTypes, mimeLabels, validateFile } from '@/lib/files';

type Block = components['schemas']['Block'];
type Props = {
  block: Extract<Block, { type: 'fileRequest' }>;
  interactive: boolean;
  onFile: (file: File) => void;
};

export function FileRequestBlock({ block, interactive, onFile }: Props) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const disabled = !interactive || sent;

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
    setSent(true);
    onFile(file);
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-3">
        <FileUp aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-ink-muted" />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{block.label}</p>
          <p className="text-[13px] text-ink-muted">
            Formats acceptés : {mimeLabels(block.acceptedMimeTypes)} · 10 Mo maximum
          </p>
        </div>
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
      <Button variant="secondary" disabled={disabled} onClick={() => inputRef.current?.click()}>
        Joindre une pièce
      </Button>
      {error && <InlineAlert>{error}</InlineAlert>}
    </Card>
  );
}
