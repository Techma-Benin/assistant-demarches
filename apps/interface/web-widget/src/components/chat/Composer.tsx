'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { IconButton, InlineAlert } from '@techma/ui';
import { ArrowUp, Paperclip } from 'lucide-react';
import { CONTRACT_MIME_TYPES, validateFile } from '@/lib/files';

type Props = { disabled: boolean; onSend: (text: string) => void; onFile: (file: File) => void };

export function Composer({ disabled, onSend, onFile }: Props) {
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const empty = text.trim().length === 0;

  // Auto-grow from 1 to 5 rows (the max height is capped in CSS).
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  function submit() {
    if (disabled || empty) return;
    onSend(text);
    setText('');
  }

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

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="bg-canvas px-3 pb-3 pt-2">
      {fileError && <InlineAlert className="mb-2">{fileError}</InlineAlert>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex items-end gap-1 rounded-pill border border-line bg-surface p-1 has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-focus"
      >
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
        <IconButton label="Joindre une pièce" variant="ghost" disabled={disabled} onClick={() => fileInput.current?.click()}>
          <Paperclip aria-hidden="true" className="size-5" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="sr-only">
            Votre message
          </label>
          <textarea
            ref={textarea}
            id={id}
            rows={1}
            maxLength={4000}
            value={text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Écrivez votre message"
            className="block max-h-[8.75rem] min-h-11 w-full resize-none bg-transparent px-2 py-2.5 text-base text-ink outline-none placeholder:text-ink-subtle disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <IconButton label="Envoyer" variant="primary" type="submit" disabled={disabled || empty}>
          <ArrowUp aria-hidden="true" className="size-5" />
        </IconButton>
      </form>
    </div>
  );
}
