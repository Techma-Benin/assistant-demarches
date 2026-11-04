'use client';

import { ArrowRight, Info, MessageSquare } from 'lucide-react';
import { useRef, useState, type CSSProperties } from 'react';
import { BrandMark, Chip, FlagGlyph, ThemeToggle, cn } from '@techma/ui';
import { Composer } from '@/components/chat/Composer';
import { useStagedFiles } from '@/hooks/use-staged-files';
import { CONTRACT_MIME_TYPES } from '@/lib/files';
import { formatRelative } from '@/lib/format-time';
import { siteConfig, type SiteConfig } from '@/lib/site-config';
import { DocumentCarousel, type CarouselItem } from './DocumentCarousel';
import { FitWord } from './FitWord';
import { HERO_PHOTOS, HeroSlideshow } from './HeroSlideshow';
import { AskDemo, PrepareDemo, ValidateDemo } from './HowItWorksDemos';
import { NeverShowcase } from './NeverDemos';
import { PromptDock } from './PromptDock';
import { CATALOGUE_PHOTO_CREDITS, CatalogueSection } from './CatalogueSection';
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

const SHOWCASE: CarouselItem[] = [
  { name: 'Acte de naissance', kind: 'acte-naissance', detail: 'État civil', question: 'Comment obtenir un acte de naissance ?' },
  { name: 'Casier judiciaire', kind: 'casier', detail: 'Justice', question: 'Comment obtenir un extrait de casier judiciaire ?' },
  { name: 'Passeport', kind: 'passeport', detail: 'Voyage', question: 'Comment renouveler mon passeport ?' },
  { name: 'Carte d’identité', kind: 'cni', detail: 'Identité', question: 'Comment obtenir ma carte d’identité ?' },
  { name: 'Certificat de résidence', kind: 'residence', detail: 'Identité', question: 'Comment obtenir un certificat de résidence ?' },
  { name: 'Création d’entreprise', kind: 'entreprise', detail: 'Entreprise', question: 'Comment créer mon entreprise ?' },
  { name: 'Permis de construire', kind: 'permis', detail: 'Foncier et logement', question: 'Comment obtenir un permis de construire ?' },
];

const STEPS = [
  { name: 'Vous demandez', text: 'À l’écrit ou à voix haute, avec vos pièces si vous les avez.' },
  { name: 'L’assistant prépare', text: 'Il trouve la fiche officielle, vous dit quoi fournir et remplit le formulaire avec vous.' },
  { name: 'Vous gardez la main', text: 'Rien ne part sans votre accord. Selon la démarche, vous validez sur le portail officiel ou l’assistant dépose le dossier pour vous.' },
];

const navLink = 'inline-flex min-h-11 items-center px-3 text-[16px] font-medium text-ink no-underline hover:underline';
const sectionPad = 'py-16 md:py-24';
const h2Class = 'm-0 font-display font-extrabold leading-[1.02] tracking-[-0.04em]';

/** Staggered entrance step: pass the order of the element inside its section. */
const rv = (i: number) => ({ 'data-r': '', style: { '--r': i } as CSSProperties });

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
  const goToQuestion = () => {
    const box = heroPrompt.current;
    if (!box) return;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.querySelector('textarea')?.focus({ preventScroll: true });
  };
  const submitDraft = (text: string) => {
    ask(text);
    setDraft('');
  };
  const showcaseRef = useReveal<HTMLElement>();
  const howRef = useReveal<HTMLElement>();
  const trustRef = useReveal<HTMLElement>();

  return (
    <div data-home="" className="relative min-h-screen overflow-x-clip bg-canvas font-sans text-ink">
      <div className="flex min-h-[100svh] flex-col">
      <header className="mx-auto flex w-full max-w-[1320px] items-center justify-between gap-x-4 px-5 py-3 md:px-8 md:py-4">
          <a href="#top" className="inline-flex min-h-11 items-center no-underline">
            <BrandMark showFlag={brandFlag} />
          </a>
          <div className="flex min-w-0 items-center gap-1">
            <nav aria-label="Navigation principale" className="hidden items-center gap-1 md:flex">
              <a href="#documents" className={navLink}>Exemples</a>
              <a href="#fonctionnement" className={navLink}>Comment ça marche</a>
              <a href="#themes" className={navLink}>Toutes les démarches</a>
            </nav>
            <ThemeToggle />
          </div>
        </header>

      <section id="top" aria-labelledby="hero-title" className="flex flex-1 flex-col">
        <div className="px-5 text-center md:px-10">
          <h1
            id="hero-title"
            className="m-0 mt-2 text-balance font-display text-[clamp(40px,min(7vw,10svh),104px)] font-extrabold leading-[0.95] tracking-[-0.045em] md:mt-4"
          >
            <span className="hero-word">Vos</span>{' '}
            <span className="hero-word" style={{ '--d': 90 } as CSSProperties}>démarches,</span>{' '}
            <span className="hero-word" style={{ '--d': 180 } as CSSProperties}>simplement.</span>
          </h1>
          <p style={{ '--d': 320 } as CSSProperties} className="hero-in m-0 mt-3 font-display text-[clamp(17px,min(2vw,2.6svh),24px)] font-semibold tracking-[-0.02em] text-ink-muted">
            Quelle que soit votre démarche, commencez ici.
          </p>
        </div>

        <div className="mt-5 px-3 md:mt-7 md:px-6">
          <div ref={heroPrompt} style={{ '--d': 440 } as CSSProperties} className="hero-in relative z-10 mx-auto -mb-8 w-full max-w-[880px] md:-mb-9">
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

        <HeroSlideshow className="min-h-[260px] flex-1 lg:min-h-[360px] lg:max-w-[1200px]" />

        <div className="flex flex-col items-center gap-2 pb-4 pt-3 text-center md:px-10 md:pb-5">
          {resume && <ResumeLine {...resume} />}
          <div className="ui-scrollbar-none flex w-full max-w-full gap-2 overflow-x-auto px-5 md:flex-wrap md:justify-center md:overflow-visible md:px-0">
            {SUGGESTIONS.map((s, i) => (
              <Chip
                key={s}
                disabled={disabled}
                onClick={() => ask(s)}
                style={{ '--d': 560 + i * 70 } as CSSProperties}
                className="hero-in shrink-0"
              >
                {s}
              </Chip>
            ))}
          </div>
          <p style={{ '--d': 860 } as CSSProperties} className="hero-in m-0 px-5 text-[14px] text-ink-muted md:text-[15px]">Sans connexion pour poser une question · Chaque information administrative cite sa fiche officielle</p>
        </div>
      </section>
      </div>

      <main>
        <section id="documents" ref={showcaseRef} aria-labelledby="documents-title" className={cn(sectionPad, 'overflow-x-clip')}>
          <div className="mx-auto mb-8 flex max-w-[1320px] flex-wrap items-end justify-between gap-x-8 gap-y-2 px-5 md:mb-10 md:px-8">
            <h2 {...rv(0)} id="documents-title" className={cn(h2Class, 'text-[clamp(30px,3.4vw,48px)]')}>
              Une démarche, un document.
            </h2>
            <p {...rv(1)} className="m-0 max-w-[40ch] text-[17px] text-ink-muted">
              Choisissez un document : l’assistant vous accompagne jusqu’au dépôt.
            </p>
          </div>
          <div {...rv(2)}>
            <DocumentCarousel items={SHOWCASE} disabled={disabled} onAsk={ask} />
          </div>
        </section>

        <section id="fonctionnement" ref={howRef} aria-labelledby="how-title" className={sectionPad}>
          <div className="mx-auto max-w-[1320px] px-5 md:px-8">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-2 md:mb-10">
              <h2 {...rv(0)} id="how-title" className={cn(h2Class, 'text-[clamp(30px,3.4vw,48px)]')}>
                Comment ça marche
              </h2>
              <p {...rv(1)} className="m-0 max-w-[40ch] text-[17px] text-ink-muted">
                Trois étapes. Vous gardez la main à chacune.
              </p>
            </div>
            <ol className="m-0 grid list-none grid-cols-1 gap-x-4 gap-y-8 p-0 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.name} {...rv(2 + i)} className="flex min-w-0 flex-col">
                  <div
                    className={cn(
                      'relative overflow-hidden rounded-card',
                      ['h-[320px]', 'h-[480px]', 'h-[440px]'][i],
                      'md:h-[clamp(440px,52svh,520px)]',
                      i === 2 ? 'bg-(--home-field-green)' : 'bg-sunken',
                    )}
                  >
                    {[<AskDemo key="d" />, <PrepareDemo key="d" />, <ValidateDemo key="d" />][i]}
                  </div>
                  <div className="mt-5 flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[15px] font-bold',
                        i === 2 ? 'bg-(--home-field-green) text-on-trust' : 'bg-ink text-canvas',
                      )}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="m-0 text-[20px] font-semibold leading-tight">{step.name}</p>
                      <p className="m-0 mt-1 max-w-[38ch] text-[16px] text-ink-muted">{step.text}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <CatalogueSection disabled={disabled} onAsk={ask} onAskOther={goToQuestion} />

        <section id="garanties" ref={trustRef} aria-labelledby="trust-title" className={sectionPad}>
          <NeverShowcase />
        </section>

      </main>

      <footer id="site-footer" aria-labelledby="footer-title" className="relative overflow-hidden bg-action text-on-action">
        <div className="mx-auto max-w-[1320px] px-5 pt-14 md:px-8 md:pt-20">
          <div className="flex flex-col gap-6 border-b border-on-action/15 pb-10 md:flex-row md:items-end md:justify-between md:pb-14">
            <h2 id="footer-title" className="m-0 max-w-[18ch] font-display text-[clamp(32px,4.4vw,64px)] font-extrabold leading-[1.02] tracking-[-0.04em]">
              Une démarche en tête ? Demandez maintenant.
            </h2>
            <button
              type="button"
              disabled={disabled}
              onClick={goToQuestion}
              className="ui-press group inline-flex min-h-14 shrink-0 items-center gap-2 self-start rounded-pill bg-canvas px-7 text-[17px] font-semibold text-ink hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-action disabled:cursor-not-allowed disabled:opacity-50 md:self-auto"
            >
              Poser ma question
              <ArrowRight aria-hidden="true" className="size-5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-10 py-10 md:grid-cols-12 md:py-14">
            <div className="col-span-2 md:col-span-4">
              <p className="m-0 flex items-center gap-2 text-[20px] font-bold">
                <FlagGlyph decorative width={26} height={19} className="shrink-0" />
                Assistant Démarches
              </p>
              <p className="m-0 mt-3 max-w-[36ch] text-[16px] leading-relaxed text-on-action/75">
                Comprendre et préparer vos démarches administratives au Bénin, à partir des fiches officielles.
              </p>
            </div>

            <nav aria-label="Démarches fréquentes" className="min-w-0 md:col-span-3">
              <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.08em] text-on-action/60">Démarches fréquentes</p>
              <ul className="m-0 mt-3 list-none p-0">
                {SHOWCASE.slice(0, 5).map((d) => (
                  <li key={d.kind}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => ask(d.question)}
                      className="group inline-flex min-h-11 items-center gap-1.5 text-left text-[16px] font-medium text-on-action hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {d.name}
                      <ArrowRight aria-hidden="true" className="size-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            <nav aria-label="Sur cette page" className="min-w-0 md:col-span-2">
              <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.08em] text-on-action/60">Sur cette page</p>
              <ul className="m-0 mt-3 list-none p-0">
                {[
                  ['#documents', 'Documents'],
                  ['#fonctionnement', 'Comment ça marche'],
                  ['#themes', 'Toutes les démarches'],
                  ['#garanties', 'Vos garanties'],
                ].map(([href, label]) => (
                  <li key={href}>
                    <a href={href} className="inline-flex min-h-11 items-center text-[16px] font-medium text-on-action no-underline hover:underline">
                      {label}
                    </a>
                  </li>
                ))}
                {reportUrl ? (
                  <li>
                    <a href={reportUrl} className="inline-flex min-h-11 items-center text-[16px] font-medium text-on-action no-underline hover:underline">
                      Signaler un problème
                    </a>
                  </li>
                ) : null}
                {privacyUrl ? (
                  <li>
                    <a href={privacyUrl} className="inline-flex min-h-11 items-center text-[16px] font-medium text-on-action no-underline hover:underline">
                      Confidentialité
                    </a>
                  </li>
                ) : null}
              </ul>
            </nav>

            <div className="col-span-2 md:col-span-3">
              <div className="rounded-card bg-on-action/[0.07] p-5">
                <p className="m-0 flex items-center gap-2 text-[16px] font-bold">
                  <Info aria-hidden="true" className="size-5 shrink-0" />
                  L’IA peut se tromper.
                </p>
                <p className="m-0 mt-2 text-[15px] leading-relaxed text-on-action/75">
                  Vérifiez toujours les informations importantes sur le portail officiel avant de déposer.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-on-action/15 py-5 text-[14px] text-on-action/70 md:flex-row md:items-start md:justify-between md:gap-8">
            <p className="m-0 shrink-0 py-3">© 2026 Techma Bénin · Assistant Démarches est une proposition de Techma Bénin.</p>
            <details className="group min-w-0 md:max-w-[56%] md:text-right">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center font-semibold text-on-action/80 hover:text-on-action [&::-webkit-details-marker]:hidden">
                Crédits photos
              </summary>
              <p className="m-0 pb-3 leading-relaxed">
                {[...HERO_PHOTOS, ...CATALOGUE_PHOTO_CREDITS].map((p, i) => (
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
        </div>

        <div className="mx-auto max-w-[1320px] px-5 pb-6 md:px-8 md:pb-8">
          <FitWord word="Démarches" className="footer-word" />
        </div>
        <div aria-hidden="true" className="relative flex h-1.5">
          <div className="flex-1 bg-(--home-field-green)" />
          <div className="flex-1 bg-sun" />
          <div className="flex-1 bg-flag-red" />
        </div>
      </footer>

      <PromptDock
        anchor={heroPrompt}
        hideNear={['site-footer']}
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
