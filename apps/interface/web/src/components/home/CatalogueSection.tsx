'use client';

import {
  Baby,
  BookUser,
  DoorClosed,
  FilePenLine,
  Fingerprint,
  Flag,
  Flower,
  Gavel,
  Hash,
  Map as MapIcon,
  PlaneTakeoff,
  Repeat,
  ShieldCheck,
  TicketCheck,
  UserRound,
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
  items: { name: string; about: string; question: string; icon: LucideIcon; kind?: DocumentKind }[];
};

const CATALOGUE: Theme[] = [
  {
    title: 'Identité',
    backdrop: { src: '/photos/fond-identite.jpg', size: 'cover', y: '50%' },
    description: 'Prouver qui vous êtes, votre nationalité et votre lieu de résidence.',
    kind: 'cni',
    items: [
      { name: 'Carte d’identité', about: 'Votre pièce d’identité nationale, pour vous identifier partout au Bénin.', question: 'Comment obtenir ma carte d’identité ?', icon: IdCard },
      { name: 'Certificat de résidence', about: 'Prouve votre adresse, souvent demandé dans un dossier administratif.', question: 'Comment obtenir un certificat de résidence ?', kind: 'residence', icon: MapPinHouse },
      { name: 'Certificat d’identification personnelle', about: 'Atteste votre identité à partir de votre numéro personnel d’identification.', question: 'Comment obtenir mon certificat d’identification personnelle ?', icon: Fingerprint },
      { name: 'Certificat de nationalité', about: 'Prouve que vous êtes de nationalité béninoise.', question: 'Comment obtenir un certificat de nationalité ?', icon: Flag },
    ],
  },
  {
    title: 'État civil',
    backdrop: { src: '/photos/esplanade-statue-bande.jpg', size: 'cover', y: '50%' },
    description: 'Les grands moments de la vie de famille, enregistrés et prouvés.',
    kind: 'acte-naissance',
    items: [
      { name: 'Acte de naissance', about: 'Le premier acte d’état civil, demandé dans presque tous les dossiers.', question: 'Comment obtenir un acte de naissance ?', icon: Baby },
      { name: 'Acte de mariage', about: 'Prouve votre mariage, pour un dossier familial ou administratif.', question: 'Comment obtenir un acte de mariage ?', icon: HeartHandshake },
      { name: 'Acte de décès', about: 'Constate un décès, nécessaire pour une succession ou une pension.', question: 'Comment obtenir un acte de décès ?', icon: Flower },
      { name: 'Certificat de coutume et de célibat', about: 'Prouve que vous êtes libre de vous marier.', question: 'Comment obtenir un certificat de coutume et de célibat ?', icon: UserRound },
    ],
  },
  {
    title: 'Voyage',
    backdrop: { src: '/photos/pirogue-ganvie.jpg', size: 'auto 200svh', y: '100%' },
    description: 'Quitter le territoire et y revenir avec les bons documents.',
    kind: 'passeport',
    items: [
      { name: 'Passeport', about: 'Le document pour voyager à l’étranger.', question: 'Comment renouveler mon passeport ?', icon: BookUser },
      { name: 'Visa', about: 'L’autorisation d’entrer au Bénin pour un visiteur étranger.', question: 'Comment demander un visa ?', icon: StampIcon },
      { name: 'Laissez-passer', about: 'Un titre de voyage temporaire, quand le passeport manque.', question: 'Comment obtenir un laissez-passer ?', icon: TicketCheck },
      { name: 'Sortie d’un mineur', about: 'L’autorisation pour qu’un enfant quitte le territoire.', question: 'Comment obtenir une autorisation de sortie du territoire pour un mineur ?', icon: PlaneTakeoff },
    ],
  },
  {
    title: 'Entreprise',
    backdrop: { src: '/photos/vieux-pont-grand-popo.jpg', size: 'auto 200svh', y: '70%' },
    description: 'Donner une existence légale à votre activité, puis la faire évoluer.',
    kind: 'entreprise',
    items: [
      { name: 'Créer une entreprise', about: 'Immatriculer votre activité pour lui donner une existence légale.', question: 'Comment créer mon entreprise ?', icon: Store },
      { name: 'Modifier une entreprise', about: 'Changer le siège, l’activité ou les dirigeants de votre entreprise.', question: 'Comment modifier mon entreprise ?', icon: FilePenLine },
      { name: 'Fermer une entreprise', about: 'Mettre fin à votre activité de façon régulière.', question: 'Comment fermer mon entreprise ?', icon: DoorClosed },
      { name: 'Numéro IFU', about: 'Votre identifiant fiscal unique, pour déclarer et payer vos impôts.', question: 'Comment obtenir mon numéro IFU ?', icon: Hash },
    ],
  },
  {
    title: 'Justice',
    backdrop: { src: '/photos/porte-non-retour-ouidah.jpg', size: 'auto 200svh', y: '62%' },
    description: 'Prouver votre situation devant la loi et obtenir les actes du tribunal.',
    kind: 'casier',
    items: [
      { name: 'Casier judiciaire', about: 'Indique si vous avez des condamnations, souvent demandé pour un emploi.', question: 'Comment obtenir un extrait de casier judiciaire ?', icon: Scale },
      { name: 'Légalisation de signature', about: 'Certifie que votre signature est authentique.', question: 'Comment faire légaliser une signature ?', icon: Signature },
      { name: 'Attestation de non-faillite', about: 'Prouve que votre entreprise n’est pas en faillite, utile pour un marché public.', question: 'Comment obtenir une attestation de non-faillite ?', icon: ShieldCheck },
      { name: 'Copie d’une décision de justice', about: 'Une copie officielle d’un jugement.', question: 'Comment obtenir la copie d’une décision de justice ?', icon: Gavel },
    ],
  },
  {
    title: 'Foncier et logement',
    backdrop: { src: '/photos/tata-somba-nadoba.jpg', size: 'auto 200svh', y: '22%' },
    description: 'Sécuriser votre terrain et construire en règle.',
    kind: 'permis',
    items: [
      { name: 'Titre foncier', about: 'Le document qui prouve que le terrain vous appartient.', question: 'Comment obtenir un titre foncier ?', icon: LandPlot },
      { name: 'Permis de construire', about: 'L’autorisation de construire sur votre terrain.', question: 'Comment obtenir un permis de construire ?', icon: HardHat },
      { name: 'Mutation de titre foncier', about: 'Inscrire le nouveau propriétaire après une vente ou une succession.', question: 'Comment faire la mutation d’un titre foncier ?', icon: Repeat },
      { name: 'Extrait de plan cadastral', about: 'Le plan officiel qui situe votre parcelle.', question: 'Comment obtenir l’extrait de plan cadastral d’une parcelle ?', icon: MapIcon },
    ],
  },
];

const sectionPad = 'py-16 md:py-24';

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
export function CatalogueSection({ disabled, onAsk }: { disabled: boolean; onAsk: (q: string) => void }) {
  const ref = useReveal<HTMLElement>();
  const [selected, setSelected] = useState(0);
  const [lifted, setLifted] = useState<number | null>(null);
  const [pointed, setPointed] = useState<number | null>(null);
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
    setPointed(null);
  };
  const point = (i: number | null) => {
    setPointed(i);
    setLifted(i !== null && i < fan.length ? i : null);
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
    <section id="themes" ref={ref} aria-labelledby="themes-title" className={cn(sectionPad, 'overflow-x-clip bg-action text-on-action lg:flex lg:min-h-[100svh] lg:flex-col lg:justify-center lg:py-10')}>
      <div className="mx-auto max-w-[1320px] px-5 md:px-8">
        {/* Decorative: the chosen theme's photo shows through the letters, fixed to the screen while the page scrolls. */}
        <div {...rv(0)}>
          <FitWord
            word="DÉMARCHES"
            max={240}
            maxScreenHeight={0.22}
            fills={CATALOGUE.map((t) => ({ backgroundImage: `url(${t.backdrop.src})`, backgroundSize: t.backdrop.size, backgroundPosition: `50% ${t.backdrop.y}` }))}
            active={selected}
            className="type-photo bg-fixed"
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-end lg:gap-x-8">
          <h2 id="themes-title" className="sr-only">
            Toutes les démarches
          </h2>
          <p {...rv(2)} className="m-0 text-[clamp(17px,1.5vw,20px)] leading-normal text-on-action/85 lg:col-span-12">
            Six thèmes, d’après les fiches officielles : choisissez une démarche, l’assistant vous dit quoi fournir.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-8 lg:mt-8 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:gap-y-6">
          <div {...rv(3)} className="min-w-0 lg:col-span-4">
            <div
              role="tablist"
              aria-label="Thèmes de démarches"
              aria-orientation={vertical ? 'vertical' : 'horizontal'}
              onKeyDown={onKey}
              className="ui-scrollbar-none -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:border-t lg:border-on-action/20 lg:px-0 lg:pb-0"
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
                    onMouseEnter={() => choose(i)}
                    onFocus={() => choose(i)}
                    className={cn(
                      'ui-press relative flex min-h-11 shrink-0 items-center justify-between gap-6 whitespace-nowrap rounded-pill border px-4 text-left text-[15px] font-semibold transition-colors duration-200',
                      'lg:rounded-none lg:border-0 lg:border-b lg:border-on-action/20 lg:px-0 lg:py-[clamp(7px,1.3svh,14px)] lg:font-display lg:text-[clamp(21px,1.9vw,28px)] lg:leading-[1.15] lg:tracking-[-0.03em]',
                      active
                        ? 'border-on-action bg-on-action text-action lg:bg-transparent lg:font-extrabold lg:text-on-action'
                        : 'border-on-action/25 text-on-action/75 hover:text-on-action lg:text-on-action/60',
                    )}
                  >
                    {t.title}
                    <span aria-hidden="true" className={cn('hidden font-mono text-[13px] font-normal transition-colors duration-200 lg:inline', active ? 'text-(--home-field-green)' : 'text-on-action/60')}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute inset-x-0 -bottom-px hidden h-0.5 origin-left bg-(--home-field-green) transition-transform duration-500 ease-out lg:block',
                        active ? 'scale-x-100' : 'scale-x-0',
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <p
            key={`${selected}-${pointed}`}
            aria-live="polite"
            className="chat-fade-in order-first m-0 max-w-[36ch] text-[17px] leading-normal text-on-action/85 lg:order-none lg:col-span-4 lg:row-start-2"
          >
            {pointed !== null && theme.items[pointed] ? (
              <>
                <span className="font-semibold text-on-action">{theme.items[pointed].name} : </span>
                {theme.items[pointed].about}
              </>
            ) : (
              theme.description
            )}
          </p>

          <div
            {...rv(4)}
            role="tabpanel"
            id="theme-panel"
            aria-labelledby={`theme-tab-${selected}`}
            className="min-w-0 overflow-hidden rounded-[24px] bg-canvas text-ink lg:col-span-8 lg:col-start-5 lg:row-span-2 lg:row-start-1"
          >
            <div className="grid min-h-full grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div aria-hidden="true" className="relative h-[220px] overflow-hidden bg-sunken md:h-auto md:min-h-[clamp(300px,40svh,420px)]">
                {CATALOGUE.map((t, ti) => {
                  const shown = ti === selected;
                  const docs = t.items.slice(0, 3);
                  return (
                    <div
                      key={t.title}
                      className={cn('absolute inset-0 flex items-center justify-center px-4 transition-opacity duration-700 ease-in-out', shown ? 'opacity-100' : 'opacity-0')}
                    >
                      {docs.map((item, i) => (
                        <div
                          key={item.name}
                          className={cn(
                            'relative aspect-[3/4] h-[62%] transition-[translate,scale] duration-300 ease-out md:h-[58%]',
                            i > 0 && '-ml-[14%]',
                            FAN_ROTATIONS[i],
                            i === 1 && 'z-[1]',
                            shown && lifted === i ? 'z-10 -translate-y-[6%] scale-[1.08]' : 'translate-y-0',
                          )}
                        >
                          <div style={{ animationDelay: `${i * 700}ms` }} className="relative size-full animate-[doc-float_5s_ease-in-out_infinite]">
                            <DocumentArt kind={item.kind ?? t.kind} className="size-full drop-shadow-md" />
                            {i === 1 && shown && <Stamp key={selected} className="doc-stamp absolute -right-[10%] bottom-[10%] size-[46%] -rotate-12" />}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              <div key={selected} className="chat-fade-in flex flex-col justify-center gap-5 p-6 md:p-8">
                <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
                  {theme.items.map((item, i) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.name}>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => onAsk(item.question)}
                          onMouseEnter={() => point(i)}
                          onMouseLeave={() => point(null)}
                          onFocus={() => point(i)}
                          onBlur={() => point(null)}
                          className="ui-press group flex h-full min-h-16 w-full items-center gap-3 rounded-[16px] border border-line bg-surface p-3 text-left transition-colors duration-200 hover:border-(--home-field-green) disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span
                            aria-hidden="true"
                            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-trust-soft text-trust-text transition-colors duration-200 group-enabled:group-hover:bg-(--home-field-green) group-enabled:group-hover:text-on-trust group-focus-visible:bg-(--home-field-green) group-focus-visible:text-on-trust"
                          >
                            <Icon className="size-5" strokeWidth={1.75} />
                          </span>
                          <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug">{item.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex justify-center pt-1">
                  <Button disabled={disabled} onClick={() => onAsk(theme.items[0]!.question)}>
                    Demander à l’assistant
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
