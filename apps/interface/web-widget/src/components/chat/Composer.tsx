'use client';

import { useId, useState, type KeyboardEvent } from 'react';

type Props = { disabled: boolean; onSend: (text: string) => void };

export function Composer({ disabled, onSend }: Props) {
  const [text, setText] = useState('');
  const id = useId();
  const empty = text.trim().length === 0;

  function submit() {
    if (disabled || empty) return;
    onSend(text);
    setText('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 border-t border-slate-200 bg-white p-3"
    >
      <div className="flex-1">
        <label htmlFor={id} className="sr-only">
          Votre message
        </label>
        <textarea
          id={id}
          rows={2}
          maxLength={4000}
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Votre message"
          className="w-full resize-none rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
        />
      </div>
      <button
        type="submit"
        disabled={disabled || empty}
        className="rounded bg-blue-700 px-4 py-2 text-sm text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Envoyer
      </button>
    </form>
  );
}
