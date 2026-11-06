'use client';

import { Check, Mic, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FlagGlyph, cn } from '@techma/ui';

export type PosterStep = { name: string; lines: [string, string]; text: string };

export const POSTER_STEPS: PosterStep[] = [
  { name: 'Vous demandez', lines: ['Vous', 'demandez.'], text: 'À l’écrit ou à voix haute, avec vos pièces si vous les avez.' },
  {
    name: 'L’assistant prépare',
    lines: ['L’assistant', 'prépare.'],
    text: 'Il trouve la fiche officielle, vous dit quoi fournir et remplit le formulaire avec vous.',
  },
  {
    name: 'Vous gardez la main',
    lines: ['Vous gardez', 'la main.'],
    text: 'Rien ne part sans votre accord. Selon la démarche, vous validez sur le portail officiel ou l’assistant dépose le dossier pour vous.',
  },
];

export const POSTER_STEP_MS = [4500, 4500, 6500];

const PANELS = [
  { panel: 'bg-[#0d6b47] text-white', eyebrow: 'text-white/80', body: 'text-white/90' },
  { panel: 'bg-[#fcd116] text-[#0d0d0f]', eyebrow: 'text-[#0d0d0f]/75', body: 'text-[#0d0d0f]' },
  { panel: 'bg-(--home-poster-night) text-white', eyebrow: 'text-[#6fd3a6]', body: 'text-[#d6d6da]' },
];

const BARS = ['bg-[#00855a]', 'bg-[#fcd116]', 'bg-[#d21034]'];

const pop = (delay: number) => ({ animationDelay: `${delay}ms` });

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-theme="light" className={cn('rounded-[24px] bg-surface p-6 text-ink shadow-[0_24px_50px_rgb(0_0_0/0.22)]', className)}>
      {children}
    </div>
  );
}

function AskVignette() {
  return (
    <div className="flex flex-col items-end gap-3">
      <p
        style={pop(350)}
        className="m-0 max-w-[330px] text-balance rounded-[26px] rounded-br-[8px] bg-white px-[22px] py-[18px] text-[20px] font-semibold leading-[1.4] text-black shadow-[0_24px_50px_rgb(0_0_0/0.25)] animate-[poster-pop_500ms_cubic-bezier(.2,1.2,.4,1)_both]"
      >
        Il me faut un acte de naissance pour mon fils
      </p>
      <p
        style={pop(800)}
        className="m-0 inline-flex items-center gap-2 rounded-pill bg-white/16 px-4 py-2.5 text-[15px] font-semibold animate-[poster-pop_400ms_ease-out_both]"
      >
        <Mic aria-hidden="true" className="size-4" />
        Ou dites-le à voix haute
      </p>
    </div>
  );
}

const PIECES = [
  { label: 'Acte de la mère', value: 'Joint' },
  { label: 'Pièce d’identité', value: 'Jointe' },
  { label: 'Formulaire', value: 'Rempli avec vous' },
];

function PrepareVignette() {
  return (
    <Card className="animate-[poster-pop_500ms_cubic-bezier(.2,1.2,.4,1)_350ms_both]">
      <p className="m-0 flex items-center gap-2.5 text-[16px] font-bold">
        <FlagGlyph decorative width={24} height={18} className="shrink-0" />
        Fiche officielle{'\u00a0'}: acte-naissance
      </p>
      <ul className="m-0 mt-3 flex list-none flex-col gap-2.5 border-t border-line p-0 pt-3">
        {PIECES.map((piece, i) => (
          <li
            key={piece.label}
            style={pop(700 + i * 250)}
            className="flex items-center justify-between gap-4 text-[16px] animate-[poster-pop_350ms_ease-out_both]"
          >
            {piece.label}
            <span className="font-bold text-trust-text">{piece.value}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function KeepVignette() {
  return (
    <Card className="relative flex flex-col gap-3.5 animate-[poster-pop_500ms_cubic-bezier(.2,1.2,.4,1)_350ms_both]">
      <p className="m-0 text-balance pr-16 text-[18px] font-extrabold sm:text-[20px] lg:pr-20">Déposer la demande{'\u00a0'}?</p>
      <p className="m-0 text-balance pr-16 text-[15px] text-ink-muted lg:pr-20">Rien n’est envoyé sans votre accord.</p>
      <div className="flex items-center gap-2.5 animate-[poster-dim_300ms_ease-out_2050ms_both]">
        <span className="inline-flex min-h-[52px] items-center whitespace-nowrap rounded-pill border border-line-strong px-4 text-[15px] font-semibold sm:px-5">Pas encore</span>
        <span className="inline-flex min-h-[52px] items-center whitespace-nowrap rounded-pill bg-[#00855a] px-5 text-[15px] font-bold text-white sm:px-6 animate-[poster-press_240ms_ease-out_1800ms_both]">
          Je valide
        </span>
      </div>
      <span className="absolute -right-3 -top-9 flex size-[96px] items-center justify-center opacity-0 animate-[poster-rosette_700ms_cubic-bezier(.2,1.2,.4,1)_2050ms_both] lg:-right-11 lg:-top-11 lg:size-[120px]">
        <span className="absolute size-[72px] rounded-[12px] bg-[#00855a] lg:size-[90px] lg:rounded-[14px]" />
        <span className="absolute size-[72px] rotate-[30deg] rounded-[12px] bg-[#00855a] lg:size-[90px] lg:rounded-[14px]" />
        <span className="absolute size-[72px] rotate-[60deg] rounded-[12px] bg-[#00855a] lg:size-[90px] lg:rounded-[14px]" />
        <span className="relative flex flex-col items-center gap-0.5 text-white">
          <Check aria-hidden="true" className="size-6 lg:size-8" strokeWidth={3} />
          <span className="text-[10px] font-extrabold tracking-[0.06em] lg:text-[12px]">DÉPOSÉE</span>
        </span>
      </span>
    </Card>
  );
}

const VIGNETTES = [AskVignette, PrepareVignette, KeepVignette];

export function HowItWorksPoster() {
  const [view, setView] = useState<{ index: number; previous: number | null; round: number }>({ index: 0, previous: null, round: 0 });
  const { index, previous, round } = view;
  const [paused, setPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [started, setStarted] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  const show = (next: number) =>
    setView((v) => ({ index: next, previous: v.index === next ? v.previous : v.index, round: v.round + 1 }));

  useEffect(() => {
    const sync = () => setPageVisible(document.visibilityState !== 'hidden');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setOnScreen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!onScreen || started) return;
    setStarted(true);
    setView((v) => ({ ...v, round: v.round + 1 }));
  }, [onScreen, started]);

  useEffect(() => {
    if (paused || !onScreen || !pageVisible) return;
    const id = window.setTimeout(
      () => setView((v) => ({ index: (v.index + 1) % POSTER_STEPS.length, previous: v.index, round: v.round + 1 })),
      POSTER_STEP_MS[index],
    );
    return () => window.clearTimeout(id);
  }, [paused, onScreen, pageVisible, index, round]);

  return (
    <div role="region" aria-roledescription="carrousel" aria-label="Les trois étapes">
      <div ref={stage} className="relative">
        <ol className="relative m-0 grid list-none overflow-hidden rounded-[28px] p-0 md:rounded-[36px]">
          {POSTER_STEPS.map((step, i) => {
            const look = PANELS[i]!;
            const active = i === index;
            const Vignette = VIGNETTES[i]!;
            return (
              <li
                key={step.name}
                aria-current={active ? 'step' : undefined}
                style={{ zIndex: active ? 3 : i === previous ? 2 : 1 }}
                onAnimationEnd={(e) => {
                  if (active && e.target === e.currentTarget) setView((v) => ({ ...v, previous: null }));
                }}
                className={cn(
                  !active && i !== previous && 'opacity-0',
                  '[grid-area:1/1] flex min-w-0 flex-col justify-center gap-10 px-6 py-10 md:px-12 md:py-14 lg:min-h-[clamp(420px,60svh,620px)] lg:flex-row lg:items-center lg:gap-12 lg:px-24 lg:py-12',
                  look.panel,
                  active && round > 1 && 'animate-[poster-wipe_750ms_cubic-bezier(.7,0,.2,1)_both]',
                )}
              >
                <div
                  key={active ? `on-${round}` : 'off'}
                  className={cn('flex min-w-0 flex-1 flex-col gap-4 lg:gap-[22px]', active && 'animate-[poster-text_650ms_cubic-bezier(.2,.8,.2,1)_200ms_both]')}
                >
                  <p className={cn('m-0 text-[14px] font-bold uppercase tracking-[0.12em] md:text-[18px]', look.eyebrow)}>
                    Étape {i + 1} sur {POSTER_STEPS.length}
                  </p>
                  <p className="m-0 font-display text-[clamp(48px,min(8.3vw,14.5svh),108px)] font-extrabold leading-[0.92] tracking-[-0.05em]">
                    <span className="block whitespace-nowrap">{step.lines[0]}</span>{' '}
                    <span className="block whitespace-nowrap">{step.lines[1]}</span>
                  </p>
                  <p className={cn('m-0 max-w-[34ch] text-[18px] leading-normal md:text-[21px]', look.body)}>{step.text}</p>
                </div>
                <div key={active ? `v-${round}` : 'v-off'} aria-hidden="true" className="w-full max-w-[420px] shrink-0 lg:w-[400px]">
                  {active ? <Vignette /> : null}
                </div>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          aria-label={paused ? 'Lire les étapes' : 'Mettre les étapes en pause'}
          onClick={() => setPaused((p) => !p)}
          className="ui-press absolute right-4 top-4 z-10 inline-flex size-11 items-center justify-center rounded-full bg-white/85 text-[#0d0d0f] shadow-[0_4px_14px_rgb(0_0_0/0.18)] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:bottom-5 lg:right-5 lg:top-auto"
        >
          {paused ? <Play aria-hidden="true" className="size-4" /> : <Pause aria-hidden="true" className="size-4" />}
        </button>
      </div>

      <div className="mt-[18px] md:px-[60px]">
        <div className="grid grid-cols-3 gap-2">
          {POSTER_STEPS.map((step, i) => (
            <button
              key={step.name}
              type="button"
              aria-label={`Étape ${i + 1} : ${step.name}`}
              aria-current={i === index ? 'step' : undefined}
              onClick={() => show(i)}
              className="group flex min-h-11 items-center rounded-pill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <span className="h-[5px] w-full overflow-hidden rounded-full bg-line-subtle">
                <span
                  key={i === index ? `bar-${round}-${paused}` : 'bar'}
                  style={i === index && !paused ? { animationDuration: `${POSTER_STEP_MS[i]}ms` } : undefined}
                  className={cn(
                    'block h-full origin-left rounded-full',
                    BARS[i],
                    i < index || (i === index && paused) ? 'w-full' : i === index ? 'w-full animate-[carousel-progress_linear_both]' : 'w-0',
                  )}
                />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
