'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { IconButton, cn } from '@techma/ui';
import type { Schemas } from '@techma/contracts-ts';
import { CASE_STATUS_LABELS } from '@/lib/cases';

type AgentMessage = Schemas['AgentMessage'];
type CopyState = 'idle' | 'copied' | 'failed';

const RESET_MS = 2000;

/**
 * Plain-text version of an answer, for the clipboard. Included: text blocks (markdown `**` and heading
 * hashes removed, list numbering kept), buttons labels, form field labels, file request label, case card
 * (title + status label + reference), consent text and login reason, blocks separated by blank lines, then a « Sources : » list.
 */
export function messagePlainText(message: AgentMessage): string {
  const parts: string[] = [];
  const sources: string[] = [];
  for (const block of message.blocks) {
    if (block.type === 'text') {
      parts.push(
        block.text
          .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
          .replace(/^\s*#{2,3}\s+/gm, '')
          .trim(),
      );
      for (const source of block.sources) sources.push(`${sources.length + 1}. ${source.procedureId} ${source.url}`);
    } else if (block.type === 'buttons') {
      parts.push(block.items.map((item) => item.label).join('\n'));
    } else if (block.type === 'form') {
      parts.push(block.fields.map((field) => field.label).join('\n'));
    } else if (block.type === 'fileRequest') {
      parts.push(block.label);
    } else if (block.type === 'caseCard') {
      parts.push(`${block.case.title} : ${CASE_STATUS_LABELS[block.case.status]} (${block.case.reference})`);
    } else if (block.type === 'consent') {
      parts.push(block.challenge.consentText);
    } else if (block.type === 'loginRequired') {
      parts.push(block.reason);
    }
  }
  const text = parts.filter((part) => part !== '').join('\n\n');
  return sources.length > 0 ? `${text}\n\nSources :\n${sources.join('\n')}` : text;
}

function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  const active = document.activeElement as HTMLElement | null;
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    active?.focus?.();
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // falls through to the legacy path
  }
  return legacyCopy(text);
}

export function MessageActions({ message, alwaysVisible }: { message: AgentMessage; alwaysVisible?: boolean }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const ok = await copyText(messagePlainText(message));
    setState(ok ? 'copied' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), RESET_MS);
  };

  return (
    <div
      className={cn(
        'flex items-center',
        !alwaysVisible &&
          'opacity-0 motion-safe:transition-opacity motion-safe:duration-150 group-focus-within:opacity-100 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100',
      )}
    >
      <span className="group/tip relative inline-flex">
        <IconButton label="Copier la réponse" onClick={copy} className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
          {state === 'copied' ? <Check aria-hidden="true" className="size-5" /> : <Copy aria-hidden="true" className="size-5" />}
        </IconButton>
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[12px] font-medium text-canvas shadow-sm',
            'transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
            state === 'copied'
              ? 'translate-y-0 opacity-100'
              : 'translate-y-0.5 opacity-0 group-hover/tip:translate-y-0 group-hover/tip:opacity-100 group-hover/tip:delay-[400ms] group-has-[:focus-visible]/tip:translate-y-0 group-has-[:focus-visible]/tip:opacity-100',
          )}
        >
          {state === 'copied' ? 'Copié' : 'Copier la réponse'}
        </span>
      </span>
      <span role="status" className="sr-only">
        {state === 'copied' ? 'Réponse copiée' : state === 'failed' ? 'Copie impossible' : ''}
      </span>
    </div>
  );
}
