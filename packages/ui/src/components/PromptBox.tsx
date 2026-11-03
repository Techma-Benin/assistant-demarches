'use client';

import { ArrowUp, Mic, Paperclip } from 'lucide-react';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import { IconButton } from './IconButton';
import { VisuallyHidden } from './VisuallyHidden';

export type PromptBoxProps = {
  /** Visually hidden label of the textarea. */
  label: string;
  placeholder?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  onSubmit: (text: string) => void;
  disabled?: boolean;
  variant?: 'hero' | 'compact';
  onAttach?: () => void;
  onMicrophone?: () => void;
  sendLabel?: string;
  /** Content rendered above the textarea inside the box e.g. a staged file. */
  attachment?: ReactNode;
  /** Allows sending with an empty text (e.g. when a file is staged). */
  canSubmit?: boolean;
  /** Rendered in place of the send button while there is nothing to send (e.g. a voice recorder button). */
  idleAction?: ReactNode;
  className?: string;
};

/** Message composer. Enter sends, Shift+Enter adds a line. Controlled or uncontrolled. */
export function PromptBox({
  label,
  placeholder,
  value,
  onValueChange,
  onSubmit,
  disabled,
  variant = 'hero',
  onAttach,
  onMicrophone,
  sendLabel = 'Envoyer',
  attachment,
  canSubmit,
  idleAction,
  className,
}: PromptBoxProps) {
  const id = useId();
  const [inner, setInner] = useState('');
  const text = value ?? inner;
  const hero = variant === 'hero';
  const empty = text.trim() === '' && !canSubmit;

  const setText = (next: string) => {
    if (value === undefined) setInner(next);
    onValueChange?.(next);
  };

  const submit = () => {
    if (disabled || empty) return;
    onSubmit(text.trim());
    if (value === undefined) setInner('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const submitButton = (
    <IconButton
      type="submit"
      variant="primary"
      label={sendLabel}
      disabled={disabled || empty}
      className="size-12"
    >
      <ArrowUp className="size-5" strokeWidth={2.5} aria-hidden="true" />
    </IconButton>
  );
  const send = idleAction && empty ? idleAction : submitButton;

  const extras = (
    <>
      {onAttach && (
        <IconButton label="Joindre un fichier" onClick={onAttach} disabled={disabled}>
          <Paperclip className="size-5" aria-hidden="true" />
        </IconButton>
      )}
      {onMicrophone && (
        <IconButton label="Dicter" onClick={onMicrophone} disabled={disabled}>
          <Mic className="size-5" aria-hidden="true" />
        </IconButton>
      )}
    </>
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={cn(
        'border border-line-strong bg-surface focus-within:border-ink',
        hero
          ? 'flex flex-col gap-2.5 rounded-[30px] pb-3.5 pl-[26px] pr-5 pt-5 shadow-prompt'
          : 'flex items-center gap-2 rounded-[28px] py-2.5 pl-4 pr-2.5 sm:pl-6',
        !hero && attachment && 'flex-wrap',
        className,
      )}
    >
      {attachment && <div className={cn('w-full min-w-0', hero ? 'pr-1' : 'pt-1 pr-2')}>{attachment}</div>}
      <VisuallyHidden>
        <label htmlFor={id}>{label}</label>
      </VisuallyHidden>
      <textarea
        id={id}
        rows={hero ? 2 : 1}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn(
          'w-full resize-none bg-transparent font-sans text-ink outline-none placeholder:text-ink-subtle disabled:cursor-not-allowed',
          hero ? 'p-0 text-[20px] leading-[1.45]' : 'ui-scrollbar-none min-h-11 min-w-0 flex-1 py-3 text-base leading-snug [field-sizing:content] max-h-40 sm:text-[17px]',
        )}
      />
      {hero ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">{extras}</div>
          {send}
        </div>
      ) : (
        <>
          {extras}
          {send}
        </>
      )}
    </form>
  );
}
