'use client';

import { MessageSquare } from 'lucide-react';
import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { AccountMenu } from '@/components/app/AccountMenu';
import { BrandMark, Button, Chip, ThemeToggle, cn } from '@techma/ui';
import { Composer } from '@/components/chat/Composer';
import { useStagedFiles } from '@/hooks/use-staged-files';
import { CONTRACT_MIME_TYPES } from '@/lib/files';
import { formatRelative } from '@/lib/format-time';
import { siteConfig, type SiteConfig } from '@/lib/site-config';
import { CatalogueSection } from './CatalogueSection';
import { DocumentArt, type DocumentKind } from './DocumentArt';
import { HERO_PHOTOS, HeroSlideshow } from './HeroSlideshow';
import { AskDemo, PrepareDemo, ValidateDemo } from './HowItWorksDemos';
import { NeverShowcase } from './NeverDemos';
import { PromptDock } from './PromptDock';
import { useReveal } from './use-reveal';

export type FrontDoorProps = {
  onAsk: (text: string) => void;
  onFiles?: (files: File[], note?: string, voice?: { durationMs: number; waveform: number[] }) => void;
  disabled?: boolean;
  config?: SiteConfig;
  /** A saved conversation the visitor can go back to; shown after mount only. */
  resume?: { title: string | null; at: string; onResume: () => void };
};

const SUGGESTIONS = ['Comment obtenir un casier judiciaire ?', 'Renouveler mon passeport', 'Déclarer une naissance', 'Créer mon entreprise'];

const SHOWCASE: { name: string; kind: DocumentKind; question: string }[] = [
  { name: 'Acte de naissance', kind: 'acte-naissance', question: 'Comment obtenir un acte de naissance ?' },
  { name: 'Casier judiciaire', kind: 'casier', question: 'Comment obtenir un extrait de casier judiciaire ?' },
  { name: 'Passeport', kind: 'passeport', question: 'Comment renouveler mon passeport ?' },
  { name: 'Carte d’identité', kind: 'cni', question: 'Comment obtenir ma carte d’identité ?' },
  { name: 'Certificat de résidence', kind: 'residence', question: 'Comment obtenir un certificat de résidence ?' },
  { name: 'Création d’entreprise', kind: 'entreprise', question: 'Comment créer mon entreprise ?' },
  { name: 'Permis de construire', kind: 'permis', question: 'Comment obtenir un permis de construire ?' },
];

const STEPS = [
  { name: 'Vous demandez', text: 'À l’écrit ou à voix haute, avec vos pièces si vous les avez.' },
  { name: 'L’assistant prépare', text: 'Il trouve la fiche officielle, vous dit quoi fournir et remplit le formulaire avec vous.' },
  { name: 'Vous gardez la main', text: 'Rien ne part sans votre accord. Selon la démarche, vous validez sur le portail officiel ou l’assistant dépose le dossier pour vous.' },
];

const navLink = 'inline-flex min-h-11 items-center px-3 text-[16px] font-medium text-ink no-underline hover:underline';
const sectionPad = 'py-24 md:py-40';
const h2Class = 'm-0 font-display font-extrabold leading-[1.02] tracking-[-0.04em]';

/** Staggered entrance step: pass the order of the element inside its section. */
const rv = (i: number) => ({ 'data-r': '', style: { '--r': i } as CSSProperties });

/** Hero load sequence: plays on mount (the hero is already in view), in 80ms steps. */
const rise = (i: number) => ({
  className: 'motion-safe:animate-[home-rise_700ms_var(--ui-ease-out)_both]',
  style: { animationDelay: `${i * 80}ms` } as CSSProperties,
});

/** A saved conversation, one quiet line under the question box: the box stays the first thing seen. */
function ResumeLine({ title, at, onResume }: NonNullable<FrontDoorProps['resume']>) {
  const when = formatRelative(at);
  return (
    <p className="m-0 flex max-w-full items-center gap-2 text-[16px] text-ink-muted motion-safe:animate-[ui-enter_150ms_ease-out_both]">
      <MessageSquare aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 truncate">
        Conversation en cours
        {title !== null && ` : « ${title} »`}
        {when && ` · ${when}`}
      </span>
      <button
        type="button"
        onClick={onResume}
        className="inline-flex min-h-11 shrink-0 items-center px-1 font-semibold text-ink underline underline-offset-4 hover:no-underline"
      >
        Reprendre
      </button>
    </p>
  );
}

export function FrontDoor({ onAsk, onFiles = () => {}, disabled = false, config = siteConfig, resume }: FrontDoorProps) {
  const { brandFlag, reportUrl, privacyUrl } = config;
  const ask = (text: string) => {
    if (!disabled) onAsk(text);
  };
  // One draft shared by the hero box and the docked box, so typing carries over when the dock appears.
  const [draft, setDraft] = useState('');
  // Staged files are shared too, so a document attached in the hero box follows into the dock.
  const staged = useStagedFiles(CONTRACT_MIME_TYPES);
  const heroPrompt = useRef<HTMLDivElement>(null);
  // « Poser ma question » (closing section): bring the hero question box into view and put the cursor in it.
  const goToQuestion = () => {
    const box = heroPrompt.current;
    if (!box) return;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    box.querySelector('textarea')?.focus({ preventScroll: true });
  };
  const submitDraft = (text: string) => {
    ask(text);
    setDraft('');
  };
  const [selected, setSelected] = useState(0);
  const showcaseButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = SHOWCASE[selected]!;
  const onShowcaseKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = (selected + step + SHOWCASE.length) % SHOWCASE.length;
    setSelected(next);
    showcaseButtons.current[next]?.focus();
  };

  const showcaseRef = useReveal<HTMLElement>();
  const howRef = useReveal<HTMLElement>();
  const trustRef = useReveal<HTMLElement>();
  const closingRef = useReveal<HTMLElement>();

  return (
    <div className="relative min-h-screen overflow-x-clip bg-canvas font-sans text-ink">
      {/* Header and hero share one screen from lg: the hero gets what the 92px header leaves. */}
      <header className="mx-auto flex max-w-[1320px] items-center justify-between gap-x-4 px-5 py-4 md:px-8 md:py-6 lg:h-[92px] lg:py-0">
          <a href="#top" className="inline-flex min-h-11 items-center no-underline">
            <BrandMark showFlag={brandFlag} />
          </a>
          <div className="flex min-w-0 items-center gap-1">
            <nav aria-label="Navigation principale" className="hidden items-center gap-1 md:flex">
              <a href="#documents" className={navLink}>Exemples</a>
              <a href="#fonctionnement" className={navLink}>Comment ça marche</a>
              <a href="#themes" className={navLink}>Toutes les démarches</a>
            </nav>
            <AccountMenu />
            <ThemeToggle />
          </div>
        </header>

      <main>
        <section
          id="top"
          aria-labelledby="hero-title"
          className="flex flex-col items-stretch lg:h-[calc(100svh-92px)] lg:min-h-[600px] lg:pb-6"
        >
          <div className="px-5 text-center md:px-10">
            <h1
              id="hero-title"
              {...rise(0)}
              className={cn(
                // From lg the title also scales with the screen height, so short laptop screens keep the photo in view.
                'm-0 mt-6 text-balance font-display text-[clamp(44px,7vw,104px)] font-extrabold leading-[0.95] tracking-[-0.045em] md:mt-12 lg:mt-2 lg:text-[clamp(44px,min(6.4vw,9.5svh),104px)]',
                rise(0).className,
              )}
            >
              Vos démarches, simplement.
            </h1>
            <p
              {...rise(1)}
              className={cn(
                'm-0 mt-4 font-display text-[clamp(18px,2vw,24px)] font-semibold tracking-[-0.02em] text-ink-muted md:mt-6 lg:mt-3',
                rise(1).className,
              )}
            >
              Quelle que soit votre démarche, commencez ici.
            </p>
          </div>

          <div className="mt-8 px-3 md:mt-12 md:px-6 lg:mt-6">
            <div
              ref={heroPrompt}
              {...rise(2)}
              className={cn('relative z-10 mx-auto -mb-8 w-full max-w-[880px] md:-mb-9', rise(2).className)}
            >
              <Composer
                variant="compact"
                label="Votre question"
                placeholder="Posez votre question, par exemple : comment obtenir un casier judiciaire ?"
                value={draft}
                onValueChange={setDraft}
                onSend={submitDraft}
                onFiles={onFiles}
                staged={staged}
                hint={false}
                disabled={disabled}
                className="w-full text-left"
              />
            </div>
          </div>

          {/* From lg the photo takes whatever height the text leaves, so the whole hero fits one screen. */}
          <HeroSlideshow className="lg:min-h-0 lg:flex-1" />

          <div className="flex flex-col items-center gap-4 px-5 pb-10 pt-6 text-center md:px-10 md:pb-14 lg:gap-3 lg:pb-0 lg:pt-4">
            {resume && <ResumeLine {...resume} />}
            <div {...rise(3)} className={cn('flex flex-wrap justify-center gap-2', rise(3).className)}>
              {SUGGESTIONS.map((s) => (
                <Chip key={s} disabled={disabled} onClick={() => ask(s)}>
                  {s}
                </Chip>
              ))}
            </div>
            <p className="m-0 text-[16px] text-ink-muted">Sans connexion pour poser une question · Chaque information administrative cite sa fiche officielle</p>
          </div>
        </section>

        <section id="documents" ref={showcaseRef} aria-labelledby="documents-title" className={cn(sectionPad, 'lg:flex lg:min-h-[100svh] lg:items-center lg:py-24')}>
          <div className="mx-auto grid w-full max-w-[1320px] grid-cols-1 items-center gap-10 px-5 md:px-8 lg:grid-cols-12 lg:gap-x-8">
            <div className="order-2 flex flex-col gap-8 lg:order-1 lg:col-span-5">
              <div {...rv(0)} role="group" aria-labelledby="documents-title" onKeyDown={onShowcaseKey} className="flex flex-col">
                <h2
                  id="documents-title"
                  className="m-0 mb-3 font-display text-[26px] font-extrabold leading-[1.15] tracking-[-0.03em] text-ink-muted lg:mb-6 lg:text-[clamp(28px,2.9vw,44px)]"
                >
                  Une démarche, un document.
                </h2>
                <div className="ui-scrollbar-none -mx-5 flex gap-x-6 overflow-x-auto px-5 lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0">
                  {SHOWCASE.map((d, i) => (
                    <button
                      key={d.kind}
                      ref={(el) => {
                        showcaseButtons.current[i] = el;
                      }}
                      type="button"
                      aria-pressed={i === selected}
                      onClick={() => setSelected(i)}
                      className={cn(
                        'ui-press relative shrink-0 whitespace-nowrap text-left font-display text-[26px] leading-[1.15] tracking-[-0.03em] lg:flex lg:items-baseline lg:justify-between lg:gap-6 lg:border-t lg:border-line lg:py-3 lg:text-[clamp(22px,2vw,30px)]',
                        i === SHOWCASE.length - 1 && 'lg:border-b',
                        i === selected ? 'font-extrabold text-ink' : 'font-semibold text-ink-muted hover:text-ink',
                      )}
                    >
                      {d.name}
                      <span aria-hidden="true" className="hidden font-mono text-[13px] font-normal text-ink-muted lg:inline">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute inset-x-0 bottom-0 hidden h-0.5 origin-left bg-(--home-field-green) transition-transform duration-300 motion-reduce:transition-none lg:block',
                          i === selected ? 'scale-x-100' : 'scale-x-0',
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div {...rv(1)} className="flex max-w-[34ch] flex-col items-start gap-4 text-[18px] leading-normal">
                <p key={selected} className="chat-fade-in m-0 font-semibold">
                  Demandez : « {current.question} »
                </p>
                <p className="m-0">L’assistant vous indique les pièces à fournir, le coût et le délai, d’après la fiche officielle.</p>
                <Button disabled={disabled} onClick={() => ask(current.question)}>
                  Demander à l’assistant
                </Button>
              </div>
            </div>

            <div {...rv(2)} className="relative order-1 mx-auto aspect-square w-[86vw] lg:order-2 lg:col-span-7 lg:size-[min(64vh,560px)] lg:w-auto">
              <div aria-hidden="true" className="absolute inset-0 rounded-full bg-sunken" />
              {SHOWCASE.map((d, i) => (
                <div
                  key={d.kind}
                  className={cn(
                    'absolute left-1/2 top-[-8%] aspect-[3/4] h-[80%] -translate-x-1/2 transition-[opacity,translate,rotate] duration-500 ease-out motion-reduce:transition-none',
                    i === selected ? 'translate-y-0 rotate-0 opacity-100' : '-rotate-3 translate-y-6 opacity-0',
                  )}
                >
                  <DocumentArt kind={d.kind} className="size-full" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="fonctionnement" ref={howRef} aria-labelledby="how-title" className={sectionPad}>
          <div className="mx-auto grid max-w-[1320px] grid-cols-1 gap-x-[10px] gap-y-4 px-5 md:px-8 lg:grid-cols-12 lg:gap-y-0">
            <h2
              {...rv(0)}
              id="how-title"
              className={cn(h2Class, 'mb-6 text-[clamp(36px,3.6vw,52px)] lg:col-span-6 lg:col-start-1 lg:row-start-1 lg:mb-0 lg:self-start')}
            >
              Comment ça marche
            </h2>
            {STEPS.map((step, i) => {
              const span = ['lg:col-span-3 lg:col-start-1', 'lg:col-span-4 lg:col-start-4', 'lg:col-span-5 lg:col-start-8'][i]!;
              const height = ['h-[34vw] min-h-[300px] lg:h-[38vh] lg:min-h-[300px]', 'h-[46vw] min-h-[440px] lg:h-[50vh] lg:min-h-[400px]', 'h-[62vw] min-h-[480px] lg:h-[62vh] lg:min-h-[480px]'][i]!;
              return [
                <div
                  key={`tile-${i}`}
                  {...rv(1 + i * 2)}
                  className={cn(
                    'relative overflow-hidden rounded-card lg:row-start-1 lg:self-end',
                    span,
                    height,
                    i === 2 ? 'bg-(--home-field-green)' : 'bg-sunken',
                  )}
                >
                  {[<AskDemo key="d" />, <PrepareDemo key="d" />, <ValidateDemo key="d" />][i]}
                </div>,
                <div key={`text-${i}`} {...rv(2 + i * 2)} className={cn('mb-6 lg:row-start-2 lg:mb-0 lg:mt-5', span)}>
                  <p className="m-0 text-[20px] font-semibold">{step.name}</p>
                  <p className="m-0 mt-1 max-w-[34ch] text-[16px] text-ink-muted">{step.text}</p>
                </div>,
              ];
            })}
          </div>
        </section>

        <CatalogueSection disabled={disabled} onAsk={ask} onAskOther={goToQuestion} />

        <section ref={trustRef} aria-labelledby="trust-title" className={sectionPad}>
          <NeverShowcase />
        </section>

        <section id="commencer" ref={closingRef} className="relative flex flex-col overflow-hidden bg-sunken">
          <div aria-hidden="true" className="relative order-2 h-[80vw] overflow-hidden lg:absolute lg:inset-0 lg:h-auto">
            <div className="absolute left-0 top-0 size-[130vw] rounded-full bg-(--home-field-green) lg:bottom-[-25svh] lg:left-[-10vw] lg:top-auto lg:size-[min(105svh,62vw)]" />
            <div className="absolute left-1/2 top-[40vw] -translate-x-1/2 -translate-y-1/2 lg:left-[26vw] lg:top-1/2">
              <div className="motion-safe:animate-[home-float_6s_ease-in-out_infinite]">
                <DocumentArt kind="acte-naissance" stamped className="block h-[54vw] w-auto -rotate-6 lg:h-[46svh]" />
              </div>
            </div>
          </div>
          <div className="relative mx-auto flex w-full max-w-[1320px] items-center px-5 pt-24 md:px-8 lg:min-h-[80svh] lg:py-24 lg:pt-24">
            <div className="flex w-full flex-col items-start gap-5 pb-10 lg:ml-auto lg:w-1/3 lg:pb-0">
              <h2 {...rv(0)} className={cn(h2Class, 'text-[40px]')}>
                Une démarche à faire ?
              </h2>
              <p {...rv(1)} className="m-0 text-[18px] leading-normal">
                Posez votre question. L’assistant trouve la fiche officielle et vous accompagne pas à pas.
              </p>
              <div {...rv(2)}>
                <Button disabled={disabled} onClick={goToQuestion}>Poser ma question</Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer id="site-footer" className="bg-action text-on-action">
        <div className="mx-auto max-w-[1320px] px-5 pb-16 pt-16 md:px-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <p className="m-0 max-w-[640px] text-[16px] leading-normal">
              <span className="font-bold">L’IA peut se tromper.</span>{' '}
              <span className="text-on-action/75">
                Vérifiez toujours les informations importantes sur le portail officiel. Assistant Démarches est une proposition de Techma Bénin.
              </span>
            </p>
            {reportUrl || privacyUrl ? (
              <div className="flex flex-wrap gap-x-6">
                {reportUrl ? (
                  <a href={reportUrl} className="inline-flex min-h-11 items-center text-[16px] font-semibold text-on-action underline-offset-4 hover:underline">
                    Signaler un problème
                  </a>
                ) : null}
                {privacyUrl ? (
                  <a href={privacyUrl} className="inline-flex min-h-11 items-center text-[16px] font-semibold text-on-action underline-offset-4 hover:underline">
                    Confidentialité
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
          <p className="m-0 mt-8 text-[16px] text-on-action/75">© 2026 Techma Bénin</p>
          {/* CC BY-SA photos must stay credited; folded behind one discreet link instead of a full paragraph. */}
          <details className="mt-2 text-[16px] text-on-action/75">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
              Crédits photos
            </summary>
            <p className="m-0 mt-1">
              {HERO_PHOTOS.map((p, i) => (
                <span key={p.page}>
                  {i > 0 && ' · '}
                  <a href={p.page} target="_blank" rel="noopener" className="underline underline-offset-4 hover:no-underline">
                    «&nbsp;{p.title}&nbsp;»
                  </a>
                  , {p.author} ({p.licence})
                </span>
              ))}
            </p>
          </details>
        </div>
        {/* The flag as a thin edge-to-edge strip closing the page: present, never shouting. */}
        <div aria-hidden="true" className="flex h-1.5">
          <div className="flex-1 bg-(--home-field-green)" />
          <div className="flex-1 bg-sun" />
          <div className="flex-1 bg-flag-red" />
        </div>
      </footer>

      <PromptDock
        anchor={heroPrompt}
        hideNear={['commencer', 'site-footer']}
        value={draft}
        onValueChange={setDraft}
        onSubmit={submitDraft}
        onFiles={onFiles}
        staged={staged}
        disabled={disabled}
      />
    </div>
  );
}
