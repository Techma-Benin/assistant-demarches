'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CitationMark, FlagGlyph, cn } from '@techma/ui';
import { ShieldCheck } from 'lucide-react';

type StampKind = 'never' | 'consent';
const STAMP_TEXT: Record<StampKind, string> = { never: 'JAMAIS', consent: 'ACCORD\nREQUIS' };

type Scene = {
  title: string;
  note?: string;
  user: string;
  agent: string;
  extra?: 'act';
  stamp: StampKind;
};

// Each scene must match the contract: identity (NPI, SMS code) is asked in a separate sign-in card, never in the chat;
// fees are paid by the assistant only through `request.pay` after the user's mandate, so payment belongs to « Agir sans votre accord ».
const SCENES: Scene[] = [
  {
    title: 'Voir votre NPI',
    note: 'Vous vous identifiez par une connexion sécurisée, à part de la conversation. L’assistant ne voit jamais votre NPI.',
    user: 'Je vous donne mon NPI pour aller plus vite ?',
    agent: 'Pas ici. Vous vous identifiez par une connexion sécurisée, à part de la conversation : je ne vois jamais votre NPI.',
    stamp: 'never',
  },
  {
    title: 'Vous demander un code SMS',
    user: 'J’ai reçu un code par SMS, je vous l’envoie ?',
    agent: 'Pas dans la conversation. S’il faut confirmer votre identité, un encart à part vous le demande et je ne le vois pas. Ne donnez ce code à personne d’autre.',
    stamp: 'never',
  },
  {
    title: 'Répondre sans source',
    note: 'Chaque tarif, pièce ou délai vient d’une fiche officielle, avec son lien.',
    user: 'C’est combien, le passeport ?',
    agent: 'Je vous donne le tarif de la fiche officielle, avec son lien. Sans fiche, je vous le dis.',
    stamp: 'never',
  },
  {
    title: 'Agir sans votre accord',
    user: 'Déposez mon dossier à ma place.',
    agent: 'D’abord votre accord : je ne fais rien sans lui.',
    extra: 'act',
    stamp: 'consent',
  },
];

const SCENE_MS = 6000;

function useSceneLoop() {
  const ref = useRef<HTMLDivElement>(null);
  const [animated, setAnimated] = useState(false);
  const [scene, setScene] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [onScreen, setOnScreen] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const remaining = useRef(SCENE_MS);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setAnimated(true);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!animated || !el || typeof IntersectionObserver === 'undefined') return;
    setOnScreen(false);
    const io = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [animated]);

  useEffect(() => {
    const sync = () => setPageVisible(document.visibilityState !== 'hidden');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const running = animated && onScreen && pageVisible;
  // Time left in the scene is kept across pauses so the CSS animations (paused) and the timer stay in sync.
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    let fired = false;
    const timer = window.setTimeout(() => {
      fired = true;
      remaining.current = SCENE_MS;
      setScene((s) => (s + 1) % SCENES.length);
    }, remaining.current);
    return () => {
      window.clearTimeout(timer);
      if (!fired) remaining.current = Math.max(0, remaining.current - (Date.now() - start));
    };
  }, [running, scene, nonce]);

  const select = (i: number) => {
    remaining.current = SCENE_MS;
    setScene(i);
    setNonce((n) => n + 1);
  };

  return { ref, animated, running, scene, nonce, select };
}

const KEYFRAMES = `
@keyframes nv-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes nv-stamp{from{opacity:0;transform:rotate(10deg) scale(1.9)}to{opacity:1;transform:none}}
@keyframes nv-hit{0%,100%{transform:none}50%{transform:translate(-6px,3px) rotate(-0.6deg)}}
@keyframes nv-out{from{opacity:1}to{opacity:0}}
@keyframes nv-bar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
`;

/** Fill of the active item's progress bar: scaleX 0 to 1 over the scene duration, paused with the loop. */
function ProgressFill({ animated, running }: { animated: boolean; running: boolean }) {
  return (
    <span
      className="block h-full origin-left bg-ink"
      style={
        animated
          ? { animation: `nv-bar ${SCENE_MS}ms linear both`, animationPlayState: running ? 'running' : 'paused' }
          : { transform: 'scaleX(1)' }
      }
    />
  );
}

function AgentHeader() {
  return (
    <div className="flex items-center gap-2">
      <FlagGlyph decorative width={22} height={16} className="shrink-0" />
      <span className="text-[15px] font-semibold text-ink">Assistant Démarches</span>
    </div>
  );
}

function ActCard() {
  return (
    <div className="flex items-center gap-3 rounded-[18px] bg-white px-4 py-3 text-black shadow-[0_1px_2px_rgb(13_13_15/0.04)]">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-trust-soft text-trust-text">
        <ShieldCheck aria-hidden="true" className="size-4" />
      </span>
      <p className="m-0 min-w-0 flex-1 text-[15px] leading-[1.4]">L’assistant peut agir sur votre demande jusqu’à 15:30</p>
      <span className="shrink-0 px-2 text-[14px] font-medium text-black/60 underline underline-offset-2">Retirer</span>
    </div>
  );
}

function Stamp({ kind }: { kind: StampKind }) {
  const consent = kind === 'consent';
  return (
    <div
      className={cn(
        'flex size-[150px] items-center justify-center rounded-full border-[6px] border-ink text-ink lg:size-[196px]',
        consent ? 'bg-sun' : 'bg-surface/90',
      )}
    >
      <div className="flex size-[122px] flex-col items-center justify-center gap-2 rounded-full border-2 border-ink lg:size-[160px]">
        <span className="whitespace-pre-line text-center font-display text-[26px] font-extrabold uppercase leading-[1] tracking-[0.03em] lg:text-[34px]">
          {STAMP_TEXT[kind]}
        </span>
        <span aria-hidden="true" className="block h-[3px] w-14 bg-current" />
      </div>
    </div>
  );
}

function StampScene({ scene, animated, running }: { scene: Scene; animated: boolean; running: boolean }) {
  const play = running ? 'running' : 'paused';
  const anim = (name: string, ms: number, delay: number, ease: string): CSSProperties | undefined =>
    animated ? { animation: `${name} ${ms}ms ${ease} ${delay}ms both`, animationPlayState: play } : undefined;
  return (
    <div
      className="relative h-full"
      style={animated ? { animation: `nv-out 300ms ease-out ${SCENE_MS - 400}ms both`, animationPlayState: play } : undefined}
    >
      <div className="absolute right-0 top-0 max-w-[88%] lg:max-w-[470px]" style={anim('nv-hit', 90, 1450, 'ease-in-out')}>
        <div
          className="rounded-[34px] bg-sunken px-6 py-5 font-display text-[22px] font-semibold leading-[1.2] tracking-[-0.02em] lg:px-8 lg:py-6 lg:text-[30px]"
          style={anim('nv-rise', 450, 300, 'ease-out')}
        >
          {scene.user}
        </div>
      </div>
      <div className="absolute right-3 top-[56px] -rotate-[14deg] lg:right-9 lg:top-[72px]" style={anim('nv-stamp', 260, 1200, 'cubic-bezier(0.3, 1.4, 0.5, 1)')}>
        <Stamp kind={scene.stamp} />
      </div>
      <div className="absolute bottom-0 left-0 flex max-w-[520px] flex-col gap-3" style={anim('nv-rise', 450, 2100, 'ease-out')}>
        <AgentHeader />
        <p className="m-0 text-[18px] font-medium leading-[1.4] text-ink lg:text-[24px]">{scene.agent}</p>
        {scene.extra && <ActCard />}
      </div>
    </div>
  );
}

const rv = (i: number) => ({ 'data-r': '', style: { '--r': i } as CSSProperties });

export function NeverShowcase(): ReactNode {
  const { ref, animated, running, scene, nonce, select } = useSceneLoop();
  return (
    <div className="mx-auto grid max-w-[1320px] grid-cols-1 gap-y-8 px-5 md:px-8 lg:grid-cols-12 lg:grid-rows-[auto_1fr_auto] lg:gap-x-8 lg:gap-y-0">
      <h2
        id="trust-title"
        {...rv(0)}
        className="m-0 font-display text-[clamp(36px,4vw,52px)] font-extrabold leading-[1.02] tracking-[-0.04em] lg:col-span-5"
      >
        Ce que l’assistant ne fera jamais.
      </h2>
      <div
        {...rv(1)}
        ref={ref}
        aria-hidden="true"
        inert
        className="pointer-events-none relative h-[400px] lg:h-[440px] lg:col-span-7 lg:col-start-6 lg:row-span-3 lg:row-start-1"
      >
        <style>{KEYFRAMES}</style>
        <StampScene key={`${scene}-${nonce}`} scene={SCENES[scene]!} animated={animated} running={running} />
      </div>
      <ul {...rv(2)} className="m-0 flex list-none flex-col gap-4 p-0 lg:col-span-5 lg:mt-10 lg:gap-6">
        {SCENES.map((item, i) => {
          const active = i === scene;
          return (
            <li key={item.title}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => select(i)}
                className={cn(
                  'flex w-full cursor-pointer flex-col gap-2 border-0 bg-transparent p-0 text-left font-display text-[18px] font-bold leading-[1.15] tracking-[-0.02em] md:text-[22px] lg:text-[26px]',
                  active ? 'text-ink' : 'text-ink-muted',
                )}
              >
                <span>{item.title}</span>
                {active && item.note && (
                  <span className="font-sans text-[16px] font-normal leading-normal tracking-normal text-ink-muted">{item.note}</span>
                )}
                {active && (
                  <span aria-hidden="true" className="block h-0.5 w-full overflow-hidden bg-line">
                    <ProgressFill key={`${scene}-${nonce}`} animated={animated} running={running} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p {...rv(3)} className="m-0 mt-8 text-[16px] text-ink-muted lg:col-span-5 lg:mt-10 lg:self-end">
        Chaque information administrative cite sa fiche officielle
        <CitationMark index={1} />
      </p>
    </div>
  );
}
