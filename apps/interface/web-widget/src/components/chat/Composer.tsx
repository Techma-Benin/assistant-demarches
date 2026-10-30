'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { InlineAlert, PromptBox } from '@techma/ui';
import { CONTRACT_MIME_TYPES, validateFile } from '@/lib/files';

type Props = { disabled: boolean; onSend: (text: string) => void; onFile: (file: File) => void };

const MAX_LENGTH = 4000;

export function Composer({ disabled, onSend, onFile }: Props) {
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || disabled) return;
    const result = validateFile(file, CONTRACT_MIME_TYPES);
    if (!result.ok) {
      setFileError(result.error);
      return;
    }
    setFileError(null);
    onFile(file);
  }

  return (
    <div>
      {fileError && <InlineAlert className="mb-2">{fileError}</InlineAlert>}
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={CONTRACT_MIME_TYPES.join(',')}
        disabled={disabled}
        onChange={handleFile}
      />
      <PromptBox
        variant="compact"
        label="Poser une autre question"
        placeholder="Poser une autre question…"
        value={text}
        onValueChange={(next) => setText(next.slice(0, MAX_LENGTH))}
        disabled={disabled}
        onAttach={() => fileInput.current?.click()}
        onSubmit={(value) => {
          onSend(value);
          setText('');
        }}
        className="shadow-prompt"
      />
      <p className="mt-3 text-center text-[13px] text-ink-muted">
        L’IA peut se tromper. Vérifiez les informations importantes sur le portail officiel.
      </p>
    </div>
  );
}
