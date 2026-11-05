'use client';

import { ArrowUpRight, Briefcase, FileSignature, Globe, IdCard, Landmark, User, UserRound, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@techma/ui';
import { CATALOGUE } from './CatalogueSection';

type Item = { name: string; question: string; icon: LucideIcon };
type Need = { title: string; items: Item[] };

const CONSULAR: Need = {
  title: 'Services consulaires',
  items: [
    { name: 'Carte consulaire', question: 'Comment obtenir ou renouveler ma carte consulaire ?', icon: IdCard },
    { name: 'Immatriculation consulaire', question: 'Comment m’immatriculer au consulat ?', icon: Landmark },
    { name: 'Procuration', question: 'Comment faire une procuration depuis l’étranger ?', icon: FileSignature },
    { name: 'Autorisation parentale', question: 'Comment obtenir une autorisation parentale depuis l’étranger ?', icon: UserRound },
  ],
};

const need = (title: string): Need => (title === CONSULAR.title ? CONSULAR : CATALOGUE.find((t) => t.title === title)!);

const AUDIENCES: { label: string; icon: LucideIcon; needs: string[] }[] = [
  { label: 'Un particulier', icon: User, needs: ['Identité', 'État civil', 'Voyage', 'Justice', 'Foncier et logement'] },
  { label: 'Une entreprise', icon: Briefcase, needs: ['Entreprise', 'Justice', 'Foncier et logement'] },
  { label: 'De la diaspora', icon: Globe, needs: [CONSULAR.title, 'État civil', 'Voyage'] },
];

const pill =
  'ui-press inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 text-left text-[15px] font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

function Step({ n, label, active, children }: { n: number; label: string; active: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3 transition-opacity duration-300', active ? 'opacity-100' : 'opacity-45')}>
      <p className="m-0 flex items-center gap-2.5 text-[15px] font-semibold text-ink-muted">
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-full text-[14px] font-bold',
            active ? 'bg-(--home-field-green) text-white' : 'bg-line text-ink-muted',
          )}
        >
          {n}
        </span>
        {label}
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function GuidedStart({ disabled, onAsk }: { disabled?: boolean; onAsk: (question: string) => void }) {
  const [audience, setAudience] = useState<number | null>(null);
  const [needTitle, setNeedTitle] = useState<string | null>(null);
  const needs = audience === null ? [] : AUDIENCES[audience]!.needs;
  const chosen = needTitle ? need(needTitle) : null;

  return (
    <div className="grid grid-cols-1 gap-8 rounded-[28px] border border-line bg-surface p-6 md:p-8 lg:grid-cols-3 lg:gap-10">
      <Step n={1} label="Vous êtes" active>
        {AUDIENCES.map((a, i) => {
          const Icon = a.icon;
          const on = audience === i;
          return (
            <button
              key={a.label}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setAudience(i);
                setNeedTitle(null);
              }}
              className={cn(pill, on ? 'border-ink bg-ink text-canvas' : 'border-line text-ink hover:border-ink')}
            >
              <Icon aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />
              {a.label}
            </button>
          );
        })}
      </Step>

      <Step n={2} label="Votre besoin" active={audience !== null}>
        {audience === null ? (
          <p className="m-0 text-[15px] text-ink-subtle">Dites-nous d’abord qui vous êtes.</p>
        ) : (
          needs.map((title) => {
            const on = needTitle === title;
            return (
              <button
                key={title}
                type="button"
                aria-pressed={on}
                onClick={() => setNeedTitle(title)}
                className={cn(pill, 'animate-[ui-enter_200ms_ease-out_both]', on ? 'border-(--home-field-green) bg-(--home-field-green) text-white' : 'border-line text-ink hover:border-ink')}
              >
                {title}
              </button>
            );
          })
        )}
      </Step>

      <Step n={3} label="Votre démarche" active={chosen !== null}>
        {chosen === null ? (
          <p className="m-0 text-[15px] text-ink-subtle">Choisissez votre besoin.</p>
        ) : (
          chosen.items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                type="button"
                disabled={disabled}
                onClick={() => onAsk(item.question)}
                aria-label={`${item.name}, demander à l’assistant`}
                className={cn(pill, 'group animate-[ui-enter_200ms_ease-out_both] border-line text-ink hover:border-(--home-field-green) disabled:cursor-not-allowed disabled:opacity-50')}
              >
                <Icon aria-hidden="true" className="size-[18px] text-trust-text" strokeWidth={1.75} />
                {item.name}
                <ArrowUpRight aria-hidden="true" className="size-4 text-ink-muted group-hover:text-ink" />
              </button>
            );
          })
        )}
      </Step>
    </div>
  );
}
