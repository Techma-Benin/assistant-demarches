'use client';

import { ArrowRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../cn';

export type RebusGlyphItem = { icon: ReactNode; label: string; className?: string };

export type RebusGlyphProps = { className?: string } & (
  | { variant: 'arrow-flag'; flag: ReactNode; items?: never }
  | { variant: 'cycle'; items: RebusGlyphItem[]; flag?: never }
);

const base =
  'inline-flex items-center justify-center rounded-[0.3em] leading-none ui-press focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

/** Inline headline glyph (rebus): a button sized in `em` whose icon swaps on click. */
export function RebusGlyph(props: RebusGlyphProps) {
  const [step, setStep] = useState(0);
  const { className } = props;

  if (props.variant === 'arrow-flag') {
    const showFlag = step % 2 === 1;
    return (
      <button
        type="button"
        aria-label={showFlag ? 'Afficher la flèche' : 'Afficher le drapeau'}
        onClick={() => setStep((s) => s + 1)}
        className={cn(base, 'ml-[0.15em] h-[1.05em] w-[1.5em] align-[-0.12em]', showFlag ? 'bg-transparent' : 'bg-action text-on-action', className)}
      >
        <span key={step} aria-hidden="true" className="ui-glyph-pop inline-flex items-center justify-center">
          {showFlag ? props.flag : <ArrowRight className="size-[0.7em]" strokeWidth={3} />}
        </span>
      </button>
    );
  }

  const items = props.items;
  if (items.length === 0) return null;
  const current = items[step % items.length];
  return (
    <button
      type="button"
      aria-label={`Changer d'exemple : ${current.label}`}
      onClick={() => setStep((s) => (s + 1) % items.length)}
      className={cn(base, 'size-[1.1em] align-[-0.1em]', current.className, className)}
    >
      <span key={step} aria-hidden="true" className="ui-glyph-pop inline-flex items-center justify-center">
        {current.icon}
      </span>
    </button>
  );
}
