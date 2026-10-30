'use client';

import {
  ArrowUpRight,
  Building2,
  Check,
  FileText,
  Globe,
  House,
  IdCard,
  Info,
  Lock,
  MessageCircle,
  Scale,
  User,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { BrandMark, Chip, Counter, CounterGrid, FlagGlyph, PromptBox, RebusGlyph, ThemeToggle, Tile, cn } from '@techma/ui';
import { siteConfig, type SiteConfig } from '@/lib/site-config';
import { PromptDock } from './PromptDock';

export type FrontDoorProps = {
  onAsk: (text: string) => void;
  disabled?: boolean;
  config?: SiteConfig;
};

const SUGGESTIONS = [
  'Comment obtenir un casier judiciaire ?',
  'Renouveler mon passeport',
  'Déclarer une naissance',
  'Créer mon entreprise',
];

const THEMES: { title: string; description: string; icon: ReactNode; badge: string; question: string }[] = [
  { title: 'Identité', description: 'Carte d’identité, nationalité', icon: <User />, badge: 'bg-action text-on-action rounded-full', question: 'Quelles démarches pour : Identité ?' },
  { title: 'État civil', description: 'Naissance, mariage, décès', icon: <FileText />, badge: 'bg-sun text-warning rounded-[18px]', question: 'Quelles démarches pour : État civil ?' },
  { title: 'Voyage', description: 'Passeport, visas', icon: <Globe />, badge: 'bg-trust text-on-trust rounded-full', question: 'Quelles démarches pour : Voyage ?' },
  { title: 'Entreprise', description: 'Créer, modifier, fermer', icon: <Building2 />, badge: 'bg-flag-red text-white rounded-[18px]', question: 'Quelles démarches pour : Entreprise ?' },
  { title: 'Justice', description: 'Casier judiciaire, attestations', icon: <Scale />, badge: 'bg-surface text-ink rounded-[18px]', question: 'Quelles démarches pour : Justice ?' },
  { title: 'Foncier & logement', description: 'Titres, permis, actes', icon: <House />, badge: 'bg-action text-sun rounded-full', question: 'Quelles démarches pour : Foncier & logement ?' },
];

const navLink =
  'inline-flex min-h-11 items-center rounded-pill px-3.5 text-[15px] font-medium text-ink no-underline hover:bg-sunken';
const tileTitle = 'font-display font-extrabold tracking-[-0.035em]';

export function FrontDoor({ onAsk, disabled = false, config = siteConfig }: FrontDoorProps) {
  const { brandFlag, whatsappNumber, reportUrl, privacyUrl } = config;
  const ask = (text: string) => {
    if (!disabled) onAsk(text);
  };
  // One draft shared by the hero box and the docked box, so typing carries over when the dock appears.
  const [draft, setDraft] = useState('');
  const heroPrompt = useRef<HTMLDivElement>(null);
  const submitDraft = (text: string) => {
    ask(text);
    setDraft('');
  };

  return (
    <div className="min-h-screen bg-canvas font-sans text-ink">
      <header className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 md:px-6 md:py-5">
        <a href="#top" className="inline-flex min-h-11 items-center no-underline">
          <BrandMark showFlag={brandFlag} />
        </a>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <nav aria-label="Navigation principale" className="hidden items-center gap-1 md:flex">
            <a href="#themes" className={navLink}>Thèmes</a>
            <a href="#fonctionnement" className={navLink}>Comment ça marche</a>
            <a href="#whatsapp" className={navLink}>WhatsApp</a>
          </nav>
          <span className="rounded-pill bg-sunken px-3 py-2 text-[12px] font-semibold text-ink-muted sm:px-3.5 sm:text-[13px] md:ml-2">
            Aucune connexion requise
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main>
        <section
          id="top"
          aria-labelledby="hero-title"
          className="mx-auto flex max-w-[1320px] flex-col items-center gap-5 px-5 pb-12 pt-10 text-center md:gap-7 md:px-6 md:pb-[72px] md:pt-24"
        >
          <h1
            id="hero-title"
            // One line at every width: the title is ≈ 12.3em wide, so its size follows the hero width (1320px max).
            className="m-0 max-w-full whitespace-nowrap font-display text-[calc((min(100vw,1320px)-48px)/12.5)] font-extrabold leading-[0.95] tracking-[-0.055em]"
          >
            Vos démarches, simplement.
          </h1>
          <p className="m-0 font-display text-[clamp(17px,3vw,36px)] font-semibold leading-[1.2] tracking-[-0.025em] text-ink-muted">
            Quelle que soit votre démarche, commencez ici
            <RebusGlyph variant="arrow-flag" flag={<FlagGlyph decorative width="1.5em" height="1.05em" />} />
          </p>

          <div ref={heroPrompt} className="mt-3 w-full max-w-[780px]">
            <PromptBox
              variant="hero"
              label="Votre question"
              placeholder="Posez votre question, par exemple : comment obtenir un casier judiciaire ?"
              value={draft}
              onValueChange={setDraft}
              onSubmit={submitDraft}
              disabled={disabled}
              className="w-full text-left"
            />
          </div>

          <div className="flex max-w-[820px] flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <Chip key={s} disabled={disabled} onClick={() => ask(s)}>
                {s}
              </Chip>
            ))}
          </div>
          <p className="m-0 mt-1 text-[14px] text-ink-muted">
            Réponses tirées des fiches officielles validées · Chaque réponse cite ses sources
          </p>
        </section>

        <section className="mx-auto max-w-[1320px] px-5 pb-6 pt-8 md:px-6 md:pb-10 md:pt-14">
          <p className="mx-auto m-0 max-w-[1100px] text-center font-display text-[clamp(30px,4.4vw,60px)] font-bold leading-[1.12] tracking-[-0.04em]">
            Un acte{' '}
            <span aria-hidden="true" className="inline-flex size-[1.1em] items-center justify-center rounded-[0.3em] bg-sun align-[-0.1em] text-warning">
              <FileText className="size-[0.62em]" strokeWidth={2.4} />
            </span>
            , un passeport{' '}
            <span aria-hidden="true" className="inline-flex size-[1.1em] items-center justify-center rounded-full bg-trust align-[-0.1em] text-on-trust">
              <Globe className="size-[0.6em]" strokeWidth={2.4} />
            </span>
            , une entreprise{' '}
            <RebusGlyph
              variant="cycle"
              className="ml-[0.05em]"
              items={[
                { label: 'Entreprise', className: 'bg-flag-red text-white', icon: <Building2 className="size-[0.62em]" strokeWidth={2.4} /> },
                { label: 'Justice', className: 'bg-sun text-warning', icon: <Scale className="size-[0.62em]" strokeWidth={2.4} /> },
                { label: 'Identité', className: 'bg-action text-on-action', icon: <IdCard className="size-[0.62em]" strokeWidth={2.4} /> },
              ]}
            />{' '}
            — une seule porte d’entrée.
          </p>
        </section>

        <section id="fonctionnement" aria-label="Comment ça marche" className="mx-auto flex max-w-[1320px] flex-wrap gap-4 px-5 py-6 md:px-6 md:py-10">
          <Tile tone="ink" className="flex min-h-[480px] min-w-0 flex-[2_1_620px] flex-col gap-7">
            <div className="flex flex-col gap-3">
              <span className="text-[14px] font-semibold opacity-70">Comment ça marche</span>
              <h2 className="m-0 max-w-[560px] font-display text-[clamp(32px,3.6vw,48px)] font-extrabold leading-[1.02] tracking-[-0.04em]">
                Demandez comme vous le diriez au guichet.
              </h2>
            </div>
            <div className="mt-auto flex flex-col gap-3">
              <div className="max-w-[80%] self-end rounded-[22px] bg-on-action/15 px-5 py-3.5 text-[16px]">
                Il me faut un acte de naissance pour mon fils
              </div>
              <div className="flex max-w-[88%] flex-col gap-3.5 rounded-[22px] bg-surface px-[22px] py-5 text-ink">
                <p className="m-0 text-[16px] leading-normal">
                  D’accord. Selon la fiche officielle, la demande se fait en ligne en indiquant la commune de naissance
                  <sup className="ml-[3px] inline-flex rounded-md bg-sunken px-1.5 align-[0.3em] text-[11px] font-bold">1</sup>. Voulez-vous que je prépare la demande&nbsp;?
                </p>
                <div className="flex flex-wrap gap-2" aria-hidden="true">
                  <span className="rounded-pill bg-action px-3.5 py-[9px] text-[14px] font-semibold text-on-action">Préparer la demande</span>
                  <span className="rounded-pill bg-sunken px-3.5 py-[9px] text-[14px] font-semibold">Pièces à fournir</span>
                </div>
              </div>
            </div>
          </Tile>

          <Tile tone="sun" className="flex min-h-[480px] min-w-0 flex-[1_1_320px] flex-col justify-between gap-6 p-7 md:p-10">
            <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-[20px] bg-action text-sun">
              <Lock className="size-[30px]" strokeWidth={2.2} />
            </span>
            <div className="flex flex-col gap-3.5">
              <h3 className={cn(tileTitle, 'm-0 text-[40px] leading-none tracking-[-0.04em]')}>Aucun NPI. Aucun code SMS.</h3>
              <p className="m-0 text-[17px] leading-normal">
                L’assistant ne vous les demandera jamais. La validation officielle se fait uniquement sur le portail.
              </p>
            </div>
          </Tile>

          <Tile className="flex min-h-[420px] min-w-0 flex-[1_1_320px] flex-col gap-[22px] p-7 md:p-10">
            <h3 className={cn(tileTitle, 'm-0 text-[32px] leading-[1.05]')}>Chaque réponse cite sa source.</h3>
            <ul className="m-0 mt-auto flex list-none flex-col gap-2.5 p-0">
              {[
                { n: '1', title: 'Acte de naissance', sub: 'Fiche validée · service-public.bj' },
                { n: '2', title: 'État civil — copie intégrale', sub: 'Fiche validée' },
              ].map((s) => (
                <li key={s.n} className="flex items-center gap-3 rounded-[18px] bg-surface px-4 py-3.5">
                  <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-action text-[13px] font-bold text-on-action">{s.n}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[15px] font-semibold">{s.title}</span>
                    <span className="text-[13px] text-ink-muted">{s.sub}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Tile>

          <Tile className="flex min-h-[420px] min-w-0 flex-[1_1_320px] flex-col gap-[22px] p-7 md:p-10">
            <h3 className={cn(tileTitle, 'm-0 text-[32px] leading-[1.05]')}>L’assistant prépare. Vous validez.</h3>
            <ol className="m-0 mt-auto flex list-none flex-col gap-2.5 p-0">
              {['Formulaire prérempli', 'Pièces jointes'].map((label) => (
                <li key={label} className="flex items-center gap-3 rounded-[18px] bg-surface px-4 py-3.5 text-[15px] font-semibold">
                  <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-trust text-on-trust">
                    <Check className="size-3" strokeWidth={3.6} />
                  </span>
                  {label}
                </li>
              ))}
              <li className="flex items-center gap-3 rounded-[18px] bg-surface px-4 py-3.5 text-[15px] font-bold">
                <span aria-hidden="true" className="box-border size-6 shrink-0 rounded-full border-[2.5px] border-ink" />
                Vous validez sur le portail
              </li>
            </ol>
          </Tile>

          <Tile id="whatsapp" tone="trust" className="flex min-h-[420px] min-w-0 flex-[1_1_320px] flex-col justify-between gap-[22px] p-7 md:p-10">
            <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-full bg-white/15">
              <MessageCircle className="size-[30px]" strokeWidth={2} />
            </span>
            <div className="flex flex-col gap-3.5">
              <h3 className={cn(tileTitle, 'm-0 text-[32px] leading-[1.05]')}>Aussi sur WhatsApp.</h3>
              <p className="m-0 text-[17px] leading-normal opacity-90">
                Le même assistant, dans l’application que vous utilisez déjà.
                {whatsappNumber ? ` Écrivez au ${whatsappNumber}.` : ''}
              </p>
            </div>
          </Tile>
        </section>

        <section id="themes" aria-labelledby="themes-title" className="mx-auto max-w-[1320px] px-5 pb-6 pt-16 md:px-6 md:pb-10 md:pt-24">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <h2 id="themes-title" className="m-0 font-display text-[clamp(40px,5vw,72px)] font-extrabold leading-[0.98] tracking-[-0.05em]">
              Ou parcourez
              <br />
              par thème.
            </h2>
            <p className="m-0 max-w-[380px] text-[17px] leading-normal text-ink-muted">
              Chaque thème ouvre une conversation déjà orientée — vous pouvez toujours préciser.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 min-[640px]:grid-cols-[repeat(auto-fill,minmax(290px,1fr))]">
            {THEMES.map((t) => (
              <button
                key={t.title}
                type="button"
                disabled={disabled}
                onClick={() => ask(t.question)}
                className="ui-press flex min-h-[200px] min-w-0 flex-col gap-10 rounded-card bg-sunken p-7 text-left text-ink hover:bg-line disabled:cursor-not-allowed disabled:opacity-50 md:min-h-[220px]"
              >
                <span className="flex items-start justify-between">
                  <span aria-hidden="true" className={cn('flex size-14 items-center justify-center [&>svg]:size-[26px] [&>svg]:stroke-[2.2]', t.badge)}>
                    {t.icon}
                  </span>
                  <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-surface">
                    <ArrowUpRight className="size-4" strokeWidth={2.6} />
                  </span>
                </span>
                <span className="flex flex-col gap-1.5">
                  <span className="font-display text-[26px] font-extrabold tracking-[-0.03em]">{t.title}</span>
                  <span className="text-[15px] text-ink-muted">{t.description}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section aria-label="En chiffres" className="mx-auto max-w-[1320px] px-5 py-16 md:px-6 md:py-24">
          <CounterGrid>
            <Counter value="1" label="seule porte d’entrée pour toutes les démarches" />
            <Counter value="24/7" label="sur le web et sur WhatsApp" tone="trust" />
            <Counter value="0" label="mot de passe ou code SMS demandé" tone="danger" />
            <Counter value="100 %" label="des informations administratives citent leur fiche" />
          </CounterGrid>
        </section>
      </main>

      <footer className="bg-sunken">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-6 px-5 pb-36 pt-12 md:px-6">
          <div className="flex max-w-[640px] flex-col gap-2">
            <span className="flex items-center gap-2 text-[15px] font-bold">
              <Info className="size-[18px] shrink-0" strokeWidth={2.2} aria-hidden="true" />
              L’IA peut se tromper.
            </span>
            <span className="text-[15px] leading-normal text-ink-muted">
              Vérifiez toujours les informations importantes sur le portail officiel. Assistant Démarches est une proposition de Techma Bénin.
            </span>
          </div>
          {reportUrl || privacyUrl ? (
            <div className="flex flex-wrap gap-2.5">
              {reportUrl ? (
                <a href={reportUrl} className="inline-flex min-h-11 items-center rounded-pill border border-ink px-5 text-[15px] font-semibold text-ink no-underline hover:bg-line">
                  Signaler un problème
                </a>
              ) : null}
              {privacyUrl ? (
                <a href={privacyUrl} className="inline-flex min-h-11 items-center rounded-pill bg-action px-5 text-[15px] font-semibold text-on-action no-underline hover:bg-action-hover">
                  Confidentialité
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </footer>

      <PromptDock anchor={heroPrompt} value={draft} onValueChange={setDraft} onSubmit={submitDraft} disabled={disabled} />
    </div>
  );
}
