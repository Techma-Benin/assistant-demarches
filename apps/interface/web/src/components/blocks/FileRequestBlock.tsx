'use client';

import { useId, useRef, useState } from 'react';
import { Button, InlineAlert, Tile } from '@techma/ui';
import { Check, Paperclip, Upload } from 'lucide-react';
import type { Schemas } from '@techma/contracts-ts';
import { effectiveMimeTypes, formatFileSize, mimeLabels, validateFile } from '@/lib/files';

type Block = Schemas['Block'];
type Props = {
  block: Extract<Block, { type: 'fileRequest' }>;
  interactive: boolean;
  /** Overrides `block.received` when a later request card shows the document was given. */
  received?: boolean;
  /** File of this line chosen but still in the composer, not sent yet. */
  pending?: { name: string; size: number } | null;
  /** File of this line that was sent from the composer (kept locally to show « Reçue »). */
  sent?: { name: string; size: number } | null;
  /** A form is active in the conversation: it can send the staged file too. */
  formActive?: boolean;
  /** `documentType` is the one of the line: the message that carries the file answers this request. */
  onFiles: (files: File[], documentType: string) => void;
};

/** One expected document of a draft: a button stages the file in the composer, `received` shows it was already given. */
export function FileRequestBlock({ block, interactive, received: receivedOverride, pending = null, sent = null, formActive = false, onFiles }: Props) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const accepted = effectiveMimeTypes(block.acceptedMimeTypes);
  const received = block.received || receivedOverride === true || sent !== null;
  const disabled = !interactive || received || pending !== null;

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
    onFiles([file], block.documentType);
  }

  return (
    <div className="flex flex-col gap-3" data-request-id={block.requestId} data-document-type={block.documentType}>
      <Tile tone="sun" className="flex flex-wrap items-center justify-between gap-5 rounded-[28px] p-7 md:p-7">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="m-0 break-words font-display text-[28px] font-extrabold tracking-[-0.035em]">{block.label}</h2>
          <p className="m-0 text-[15px]">{mimeLabels(accepted)} · stockée à part, jamais dans la conversation</p>
        </div>
        <label htmlFor={inputId} className="sr-only">
          Ajouter {block.label}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className="sr-only"
          tabIndex={-1}
          accept={accepted.join(',')}
          disabled={disabled}
          onChange={handleChange}
        />
        {received ? (
          <span className="inline-flex min-w-0 items-center gap-2.5 rounded-pill bg-surface px-[18px] py-3 text-[15px] font-semibold text-ink">
            <Check aria-hidden="true" className="size-[18px] shrink-0 text-trust-text" strokeWidth={2.6} />
            <span className="min-w-0 break-all">
              {sent ? `Reçue : ${sent.name} · ${formatFileSize(sent.size)}` : 'Pièce reçue'}
            </span>
          </span>
        ) : pending ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="inline-flex min-w-0 items-center gap-2.5 rounded-pill bg-surface px-[18px] py-3 text-[15px] font-semibold text-ink">
              <Paperclip aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={2.4} />
              <span className="min-w-0 break-all">Prête à envoyer : {pending.name}</span>
            </span>
            <p className="m-0 text-[13px]">
              {formActive ? 'Envoyez-la avec la flèche du message, ou avec le formulaire.' : 'Envoyez-la avec la flèche du message.'}
            </p>
          </div>
        ) : (
          <Button
            size="lg"
            disabled={disabled}
            className="min-h-[52px] px-6 font-bold"
            leadingIcon={<Upload aria-hidden="true" className="size-[18px]" strokeWidth={2.4} />}
            onClick={() => inputRef.current?.click()}
          >
            Ajouter cette pièce
          </Button>
        )}
      </Tile>
      {error && <InlineAlert>{error}</InlineAlert>}
    </div>
  );
}
