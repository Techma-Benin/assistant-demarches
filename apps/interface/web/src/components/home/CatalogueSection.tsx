'use client';

import {
  ArrowUpRight,
  Baby,
  BookUser,
  DoorClosed,
  FilePenLine,
  Fingerprint,
  Flag,
  Flower,
  HardHat,
  HeartHandshake,
  IdCard,
  LandPlot,
  MapPinHouse,
  Scale,
  Signature,
  Stamp as StampIcon,
  Store,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Button, cn } from '@techma/ui';
import { DocumentArt, Stamp, type DocumentKind } from './DocumentArt';
import { FitWord } from './FitWord';
import { useReveal } from './use-reveal';

type Theme = {
  title: string;
  description: string;
  kind: DocumentKind;
  backdrop: { src: string; size: string; y: string };
  items: { name: string; question: string; icon: LucideIcon; kind?: DocumentKind }[];
};

const CATALOGUE: Theme[] = [
  {
    title: 'Identité',
    backdrop: { src: '/photos/fond-identite.jpg', size: 'cover', y: '50%' },
    description: 'Carte d’identité, certificats de résidence et de nationalité : les pièces qui prouvent qui vous êtes.',
    kind: 'cni',
    items: [
      { name: 'Carte d’identité', question: 'Comment obtenir ma carte d’identité ?', icon: IdCard },
      { name: 'Certificat de résidence', question: 'Comment obtenir un certificat de résidence ?', kind: 'residence', icon: MapPinHouse },
      { name: 'Certificat d’identification personnelle', question: 'Comment obtenir mon certificat d’identification personnelle ?', icon: Fingerprint },
      { name: 'Certificat de nationalité', question: 'Comment obtenir un certificat de nationalité ?', icon: Flag },
    ],
  },
  {
    title: 'État civil',
    backdrop: { src: '/photos/esplanade-statue-bande.jpg', size: 'cover', y: '50%' },
    description: 'Naissance, mariage, décès : les actes à demander, et comment les obtenir.',
    kind: 'acte-naissance',
    items: [
      { name: 'Acte de naissance', question: 'Comment obtenir un acte de naissance ?', icon: Baby },
      { name: 'Acte de mariage', question: 'Comment obtenir un acte de mariage ?', icon: HeartHandshake },
      { name: 'Acte de décès', question: 'Comment obtenir un acte de décès ?', icon: Flower },
    ],
  },
  {
    title: 'Voyage',
    backdrop: { src: '/photos/pirogue-ganvie.jpg', size: 'auto 200svh', y: '100%' },
    description: 'Passeport et visa : les pièces, le coût et le délai avant de partir.',
    kind: 'passeport',
    items: [
      { name: 'Passeport', question: 'Comment renouveler mon passeport ?', icon: BookUser },
      { name: 'Visa', question: 'Comment demander un visa ?', icon: StampIcon },
    ],
  },
  {
    title: 'Entreprise',
    backdrop: { src: '/photos/vieux-pont-grand-popo.jpg', size: 'auto 200svh', y: '70%' },
    description: 'Créer, modifier ou fermer une entreprise, étape par étape.',
    kind: 'entreprise',
    items: [
      { name: 'Créer une entreprise', question: 'Comment créer mon entreprise ?', icon: Store },
      { name: 'Modifier une entreprise', question: 'Comment modifier mon entreprise ?', icon: FilePenLine },
      { name: 'Fermer une entreprise', question: 'Comment fermer mon entreprise ?', icon: DoorClosed },
    ],
  },
  {
    title: 'Justice',
    backdrop: { src: '/photos/porte-non-retour-ouidah.jpg', size: 'auto 200svh', y: '62%' },
    description: 'Casier judiciaire et légalisation de signature, sans aller-retour inutile.',
    kind: 'casier',
    items: [
      { name: 'Casier judiciaire', question: 'Comment obtenir un extrait de casier judiciaire ?', icon: Scale },
      { name: 'Légalisation de signature', question: 'Comment faire légaliser une signature ?', icon: Signature },
    ],
  },
  {
    title: 'Foncier et logement',
    backdrop: { src: '/photos/tata-somba-nadoba.jpg', size: 'auto 200svh', y: '22%' },
    description: 'Titre foncier et permis de construire : savoir quoi préparer avant de déposer.',
    kind: 'permis',
    items: [
      { name: 'Titre foncier', question: 'Comment obtenir un titre foncier ?', icon: LandPlot },
      { name: 'Permis de construire', question: 'Comment obtenir un permis de construire ?', icon: HardHat },
    ],
  },
];

const sectionPad = 'py-16 md:py-24';
const h2Class = 'm-0 font-display font-extrabold leading-[1.02] tracking-[-0.04em]';

/** Staggered entrance step: pass the order of the element inside its section. */
const rv = (i: number) => ({ 'data-r': '', style: { '--r': i } as CSSProperties });

export const CATALOGUE_PHOTO_CREDITS = [
  {
    src: '/photos/tata-somba-nadoba.jpg',
    title: 'Tata Somba de Nadoba',
    author: 'Step may',
    licence: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Tata_Somba_de_Nadoba.jpg',
  },
];

const FAN_ROTATIONS = ['-rotate-[8deg]', 'rotate-0', 'rotate-[8deg]'];

/** « Toutes les démarches »: themes on the left, the selected theme as one detail card on the right. */
export function CatalogueSection({ disabled, onAsk, onAskOther }: { disabled: boolean; onAsk: (q: string) => void; onAskOther: () => void }) {
  const ref = useReveal<HTMLElement>();
  const [selected, setSelected] = useState(0);
  const [lifted, setLifted] = useState<number | null>(null);
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

  const choose = (next: number) => {
    setSelected(next);
    setLifted(null);
  };
  const move = (next: number) => {
    choose(next);
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
    <section id="themes" ref={ref} aria-labelledby="themes-title" className={cn(sectionPad, 'overflow-x-clip bg-action text-on-action lg:flex lg:min-h-[100svh] lg:flex-col lg:justify-center lg:py-16')}>
      <div className="mx-auto max-w-[1320px] px-5 md:px-8">
        {/* Decorative: the photo shows through the letters and drifts slowly. */}
        <div {...rv(0)}>
          <FitWord
            word="DÉMARCHES"
            max={240}
            maxScreenHeight={0.22}
            fills={CATALOGUE.map((t) => ({ backgroundImage: `url(${t.backdrop.src})`, backgroundSize: t.backdrop.size, backgroundPosition: `50% ${t.backdrop.y}`, '--fy': t.backdrop.y }) as CSSProperties)}
            active={selected}
            className="type-photo bg-fixed animate-[home-pan_24s_ease-in-out_infinite_alternate]"
          />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 lg:mt-8 lg:grid-cols-12 lg:items-end lg:gap-x-8">
          <h2 {...rv(1)} id="themes-title" className={cn(h2Class, 'text-[clamp(36px,4vw,56px)] lg:col-span-6')}>
            Toutes les démarches.
          </h2>
          <p {...rv(2)} className="m-0 max-w-[48ch] text-[18px] leading-normal lg:col-span-5 lg:col-start-8">
            Six thèmes, d’après les fiches officielles du service public. Choisissez une démarche : l’assistant vous dit quoi fournir et vous accompagne.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:mt-12 lg:grid-cols-12 lg:gap-x-8">
          <div {...rv(3)} className="flex min-w-0 flex-col gap-8 lg:col-span-4">
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
                    onClick={() => choose(i)}
                    className={cn(
                      'ui-press relative flex shrink-0 items-baseline justify-between gap-6 whitespace-nowrap px-4 py-3 text-left font-display text-[20px] leading-[1.15] tracking-[-0.03em] lg:border-t lg:border-on-action/20 lg:px-0 lg:py-[clamp(10px,1.8svh,18px)] lg:text-[clamp(22px,2vw,30px)]',
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
                        'absolute inset-x-0 bottom-0 h-0.5 origin-left bg-(--home-field-green) transition-transform duration-300',
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
              <div aria-hidden="true" className="relative flex h-[200px] items-end justify-center overflow-hidden bg-sunken lg:h-[clamp(220px,30svh,320px)]">
                {fan.map((item, i) => (
                  <div
                    key={item.name}
                    style={{ animationDelay: `${i * 80}ms` }}
                    className={cn(
                      'relative aspect-[3/4] h-[88%] animate-[home-rise_600ms_var(--ui-ease-out)_both] transition-[translate,scale] duration-300 ease-out',
                      i > 0 && '-ml-[6%]',
                      FAN_ROTATIONS[fan.length === 2 && i === 1 ? 2 : i],
                      lifted === i ? 'z-10 translate-y-[1%] scale-[1.08]' : 'translate-y-[8%]',
                    )}
                  >
                    <div style={{ animationDelay: `${600 + i * 700}ms` }} className="relative size-full animate-[doc-float_5s_ease-in-out_infinite]">
                      <DocumentArt kind={item.kind ?? theme.kind} className="size-full drop-shadow-md" />
                      {i === 1 && <Stamp className="doc-stamp absolute -right-[8%] bottom-[12%] size-[44%] -rotate-12" />}
                    </div>
                  </div>
                ))}
              </div>
              <div className="chat-fade-in grid grid-cols-1 gap-8 p-6 md:grid-cols-2 md:gap-10 md:p-9">
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
                    {theme.items.map((item, i) => {
                      const Icon = item.icon;
                      return (
                      <li key={item.name} className="border-t border-line last:border-b">
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => onAsk(item.question)}
                          onMouseEnter={() => setLifted(i < fan.length ? i : null)}
                          onMouseLeave={() => setLifted(null)}
                          onFocus={() => setLifted(i < fan.length ? i : null)}
                          onBlur={() => setLifted(null)}
                          className="ui-press group flex min-h-14 w-full items-center gap-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span
                            aria-hidden="true"
                            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-trust-soft text-trust-text transition-colors duration-200 group-enabled:group-hover:bg-(--home-field-green) group-enabled:group-hover:text-on-trust group-focus-visible:bg-(--home-field-green) group-focus-visible:text-on-trust"
                          >
                            <Icon className="size-5" strokeWidth={1.75} />
                          </span>
                          <span className="min-w-0 flex-1 text-[16px] font-semibold group-enabled:group-hover:underline">{item.name}</span>
                          <ArrowUpRight aria-hidden="true" className="size-5 shrink-0" />
                        </button>
                      </li>
                      );
                    })}
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
