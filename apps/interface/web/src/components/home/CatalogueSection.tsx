'use client';

import { ArrowUpRight } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Button, cn } from '@techma/ui';
import { DocumentArt, type DocumentKind } from './DocumentArt';
import { useReveal } from './use-reveal';

type Theme = {
  title: string;
  description: string;
  kind: DocumentKind;
  items: { name: string; question: string; kind?: DocumentKind }[];
};

const CATALOGUE: Theme[] = [
  {
    title: 'Identité',
    description: 'Carte d’identité, certificats de résidence et de nationalité : les pièces qui prouvent qui vous êtes.',
    kind: 'cni',
    items: [
      { name: 'Carte d’identité', question: 'Comment obtenir ma carte d’identité ?' },
      { name: 'Certificat de résidence', question: 'Comment obtenir un certificat de résidence ?', kind: 'residence' },
      { name: 'Certificat d’identification personnelle', question: 'Comment obtenir mon certificat d’identification personnelle ?' },
      { name: 'Certificat de nationalité', question: 'Comment obtenir un certificat de nationalité ?' },
    ],
  },
  {
    title: 'État civil',
    description: 'Naissance, mariage, décès : les actes à demander, et comment les obtenir.',
    kind: 'acte-naissance',
    items: [
      { name: 'Acte de naissance', question: 'Comment obtenir un acte de naissance ?' },
      { name: 'Acte de mariage', question: 'Comment obtenir un acte de mariage ?' },
      { name: 'Acte de décès', question: 'Comment obtenir un acte de décès ?' },
    ],
  },
  {
    title: 'Voyage',
    description: 'Passeport et visa : les pièces, le coût et le délai avant de partir.',
    kind: 'passeport',
    items: [
      { name: 'Passeport', question: 'Comment renouveler mon passeport ?' },
      { name: 'Visa', question: 'Comment demander un visa ?' },
    ],
  },
  {
    title: 'Entreprise',
    description: 'Créer, modifier ou fermer une entreprise, étape par étape.',
    kind: 'entreprise',
    items: [
      { name: 'Créer une entreprise', question: 'Comment créer mon entreprise ?' },
      { name: 'Modifier une entreprise', question: 'Comment modifier mon entreprise ?' },
      { name: 'Fermer une entreprise', question: 'Comment fermer mon entreprise ?' },
    ],
  },
  {
    title: 'Justice',
    description: 'Casier judiciaire et légalisation de signature, sans aller-retour inutile.',
    kind: 'casier',
    items: [
      { name: 'Casier judiciaire', question: 'Comment obtenir un extrait de casier judiciaire ?' },
      { name: 'Légalisation de signature', question: 'Comment faire légaliser une signature ?' },
    ],
  },
  {
    title: 'Foncier et logement',
    description: 'Titre foncier et permis de construire : savoir quoi préparer avant de déposer.',
    kind: 'permis',
    items: [
      { name: 'Titre foncier', question: 'Comment obtenir un titre foncier ?' },
      { name: 'Permis de construire', question: 'Comment obtenir un permis de construire ?' },
    ],
  },
];

const sectionPad = 'py-24 md:py-40';
const h2Class = 'm-0 font-display font-extrabold leading-[1.02] tracking-[-0.04em]';

/** Staggered entrance step: pass the order of the element inside its section. */
const rv = (i: number) => ({ 'data-r': '', style: { '--r': i } as CSSProperties });

const FAN_ROTATIONS = ['-rotate-[8deg]', 'rotate-0', 'rotate-[8deg]'];

/** « Toutes les démarches »: themes on the left, the selected theme as one detail card on the right. */
export function CatalogueSection({ disabled, onAsk, onAskOther }: { disabled: boolean; onAsk: (q: string) => void; onAskOther: () => void }) {
  const ref = useReveal<HTMLElement>();
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  // Vertical list from lg up, horizontal scroll row below: the tablist orientation follows the layout.
  const [vertical, setVertical] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia?.('(min-width: 1024px)');
    if (!mq) return;
    const sync = () => setVertical(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);
  const theme = CATALOGUE[selected]!;
  const fan = theme.items.slice(0, 3);

  const move = (next: number) => {
    setSelected(next);
    tabs.current[next]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const last = CATALOGUE.length - 1;
    let next: number;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = selected === last ? 0 : selected + 1;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = selected === 0 ? last : selected - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    move(next);
  };

  return (
    <section id="themes" ref={ref} aria-labelledby="themes-title" className={cn(sectionPad, 'overflow-x-clip bg-action text-on-action')}>
      <div className="mx-auto max-w-[1320px] px-5 md:px-8">
        {/* Decorative: the photo shows through the letters and drifts slowly. */}
        <div
          {...rv(0)}
          aria-hidden="true"
          style={{ ...rv(0).style, backgroundImage: 'url(/photos/esplanade-amazone-lever-soleil.jpg)' }}
          className="select-none whitespace-nowrap bg-cover bg-clip-text bg-[position:50%_50%] pt-[0.1em] font-display text-[clamp(48px,15vw,240px)] font-extrabold uppercase leading-[0.85] tracking-[-0.05em] text-transparent motion-safe:animate-[home-pan_30s_ease-in-out_infinite_alternate]"
        >
          Démarches
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-x-8">
          <h2 {...rv(1)} id="themes-title" className={cn(h2Class, 'text-[clamp(36px,4vw,52px)] lg:col-span-6')}>
            Toutes les démarches.
          </h2>
          <p {...rv(2)} className="m-0 max-w-[48ch] text-[18px] leading-normal lg:col-span-5 lg:col-start-8">
            Six thèmes, d’après les fiches officielles du service public. Choisissez une démarche : l’assistant vous dit quoi fournir et vous accompagne.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-10 lg:mt-16 lg:grid-cols-12 lg:gap-x-8">
          <div {...rv(3)} className="flex min-w-0 flex-col gap-10 lg:col-span-4">
            <div
              role="tablist"
              aria-label="Thèmes de démarches"
              aria-orientation={vertical ? 'vertical' : 'horizontal'}
              onKeyDown={onKey}
              className="ui-scrollbar-none -mx-5 flex overflow-x-auto px-5 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
            >
              {CATALOGUE.map((t, i) => {
                const active = i === selected;
                return (
                  <button
                    key={t.title}
                    ref={(el) => {
                      tabs.current[i] = el;
                    }}
                    type="button"
                    role="tab"
                    id={`theme-tab-${i}`}
                    aria-selected={active}
                    aria-controls="theme-panel"
                    tabIndex={active ? 0 : -1}
                    onClick={() => setSelected(i)}
                    className={cn(
                      'ui-press relative flex shrink-0 items-baseline justify-between gap-6 whitespace-nowrap px-4 py-3 text-left font-display text-[20px] leading-[1.15] tracking-[-0.03em] lg:border-t lg:border-on-action/20 lg:px-0 lg:text-[clamp(22px,2vw,30px)]',
                      i === CATALOGUE.length - 1 && 'lg:border-b',
                      active ? 'font-extrabold text-on-action' : 'font-semibold text-on-action/60 hover:text-on-action',
                    )}
                  >
                    {t.title}
                    <span aria-hidden="true" className="hidden font-mono text-[13px] font-normal text-on-action/60 lg:inline">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute inset-x-0 bottom-0 h-0.5 origin-left bg-(--home-field-green) transition-transform duration-300 motion-reduce:transition-none',
                        active ? 'scale-x-100' : 'scale-x-0',
                      )}
                    />
                  </button>
                );
              })}
            </div>

            <div className="flex max-w-[34ch] flex-col items-start gap-2 text-[16px] leading-normal">
              <p className="m-0 font-semibold">Une autre démarche ?</p>
              <p className="m-0 text-on-action/75">Posez votre question : l’assistant cherche dans toutes les fiches du service public.</p>
              <button
                type="button"
                onClick={onAskOther}
                className="ui-press inline-flex min-h-11 items-center font-semibold text-on-action underline underline-offset-4 hover:no-underline"
              >
                Poser ma question
              </button>
            </div>
          </div>

          <div
            {...rv(4)}
            role="tabpanel"
            id="theme-panel"
            aria-labelledby={`theme-tab-${selected}`}
            className="min-w-0 overflow-hidden rounded-[24px] bg-canvas text-ink lg:col-span-8"
          >
            {/* Re-mounted on tab change so the fan and the text enter again. */}
            <div key={selected}>
              <div aria-hidden="true" className="relative flex h-[200px] items-end justify-center overflow-hidden bg-sunken lg:h-[240px]">
                {fan.map((item, i) => (
                  <div
                    key={item.name}
                    style={{ animationDelay: `${i * 80}ms` }}
                    className={cn(
                      'relative h-[88%] translate-y-[8%] aspect-[3/4] motion-safe:animate-[home-rise_600ms_var(--ui-ease-out)_both]',
                      i > 0 && '-ml-[6%]',
                      FAN_ROTATIONS[fan.length === 2 && i === 1 ? 2 : i],
                    )}
                  >
                    <DocumentArt kind={item.kind ?? theme.kind} className="size-full drop-shadow-md" />
                  </div>
                ))}
              </div>
              <div className="chat-fade-in grid grid-cols-1 gap-8 p-6 md:grid-cols-2 md:gap-10 md:p-8">
                <div className="flex flex-col items-start gap-4">
                  <h3 className="m-0 font-display text-[28px] font-extrabold leading-[1.1] tracking-[-0.03em]">{theme.title}</h3>
                  <p className="m-0 text-[16px] leading-normal text-ink-muted">{theme.description}</p>
                  <Button disabled={disabled} onClick={() => onAsk(theme.items[0]!.question)}>
                    Demander à l’assistant
                  </Button>
                </div>
                <div className="flex flex-col gap-3">
                  <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.08em] text-(--home-field-green)">Les démarches</p>
                  <ul className="m-0 flex list-none flex-col p-0">
                    {theme.items.map((item) => (
                      <li key={item.name} className="border-t border-line last:border-b">
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => onAsk(item.question)}
                          className="ui-press group flex min-h-12 w-full items-center justify-between gap-4 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="text-[16px] font-semibold group-enabled:group-hover:underline">{item.name}</span>
                          <ArrowUpRight aria-hidden="true" className="size-5 shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
