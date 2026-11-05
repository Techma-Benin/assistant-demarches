'use client';

import { BookCheck, Fingerprint, HandHeart, MessageSquareLock, Play, RotateCcw, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { CitationMark, FlagGlyph, SourcePill, cn } from '@techma/ui';

type StampKind = 'never' | 'consent';
const STAMP_TEXT: Record<StampKind, string> = { never: 'JAMAIS', consent: 'ACCORD REQUIS' };

type Scene = {
  title: string;
  note: string;
  user: string;
  agent: string;
  icon: LucideIcon;
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
    icon: Fingerprint,
    stamp: 'never',
  },
  {
    title: 'Vous demander un code SMS',
    note: 'S’il faut confirmer votre identité, un encart à part vous le demande : l’assistant ne le voit jamais.',
    user: 'J’ai reçu un code par SMS, je vous l’envoie ?',
    agent: 'Pas dans la conversation. S’il faut confirmer votre identité, un encart à part vous le demande et je ne le vois pas. Ne donnez ce code à personne d’autre.',
    icon: MessageSquareLock,
    stamp: 'never',
  },
  {
    title: 'Répondre sans source',
    note: 'Chaque tarif, pièce ou délai vient d’une fiche officielle, avec son lien.',
    user: 'C’est combien, le passeport ?',
    agent: 'Je vous donne le tarif de la fiche officielle, avec son lien. Sans fiche, je vous le dis.',
    icon: BookCheck,
    stamp: 'never',
  },
  {
    title: 'Agir sans votre accord',
    note: 'Rien n’est fait sans votre accord, et vous pouvez le retirer à tout moment.',
    user: 'Déposez mon dossier à ma place.',
    agent: 'D’abord votre accord : je ne fais rien sans lui.',
    icon: HandHeart,
    extra: 'act',
    stamp: 'consent',
  },
];

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

function StampBadge({ kind }: { kind: StampKind }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 -rotate-6 items-center rounded-[8px] border-2 px-2.5 py-1 font-display text-[13px] font-extrabold uppercase tracking-[0.08em]',
        kind === 'consent' ? 'border-ink bg-sun text-ink' : 'border-flag-red text-flag-red',
      )}
    >
      {STAMP_TEXT[kind]}
    </span>
  );
}

function Exchange({ scene }: { scene: Scene }) {
  const step = (delay: number): CSSProperties => ({ animation: `nv-rise 420ms ease-out ${delay}ms both` });
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3">
      <p className="m-0 ml-auto max-w-[80%] rounded-[20px] rounded-br-[6px] bg-action px-4 py-3 text-[16px] font-medium leading-snug text-on-action" style={step(0)}>
        {scene.user}
      </p>
      <div className="flex max-w-[86%] flex-col gap-2" style={step(700)}>
        <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-muted">
          <FlagGlyph decorative width={18} height={13} className="shrink-0" />
          Assistant Démarches
        </span>
        <p className="m-0 rounded-[20px] rounded-bl-[6px] bg-surface px-4 py-3 text-[16px] leading-snug text-ink shadow-[0_1px_3px_rgb(0_0_0/0.08)]">{scene.agent}</p>
        {scene.extra && <ActCard />}
      </div>
    </div>
  );
}

function PromiseCard({ scene, open, onToggle }: { scene: Scene; open: boolean; onToggle: () => void }) {
  const Icon = scene.icon;
  return (
    <li
      className={cn(
        'flex flex-col rounded-[24px] border bg-surface p-5 transition-colors duration-200 md:p-6',
        open ? 'border-(--home-field-green) ring-2 ring-(--home-field-green)/25' : 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-[16px] bg-trust-soft text-trust-text">
          <Icon className="size-6" strokeWidth={1.75} />
        </span>
        <StampBadge kind={scene.stamp} />
      </div>
      <h3 className="m-0 mt-4 font-display text-[clamp(20px,1.8vw,24px)] font-extrabold leading-[1.15] tracking-[-0.025em] text-ink">{scene.title}</h3>
      <p className="m-0 mb-4 mt-2 text-[16px] leading-normal text-ink-muted">{scene.note}</p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="promise-stage"
        onClick={onToggle}
        className="ui-press mt-auto inline-flex min-h-11 items-center gap-2 self-start rounded-pill border border-line px-4 text-[15px] font-semibold text-ink hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {open ? <RotateCcw aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
        {open ? 'Revoir' : 'Essayez'}
      </button>
    </li>
  );
}

const rv = (i: number) => ({ 'data-r': '', style: { '--r': i } as CSSProperties });

export function NeverShowcase(): ReactNode {
  const [open, setOpen] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const toggle = (i: number) => {
    setOpen(i);
    setNonce((n) => n + 1);
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches)
      window.requestAnimationFrame(() => document.getElementById('promise-stage')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };
  return (
    <div className="mx-auto max-w-[1320px] px-5 md:px-8">
      <style>{'@keyframes nv-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}'}</style>
      <div {...rv(0)} className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-2 md:mb-10">
        <h2 id="trust-title" className="m-0 font-display text-[clamp(32px,3.6vw,52px)] font-extrabold leading-[1.02] tracking-[-0.04em]">
          Ce que l’assistant ne fera jamais.
        </h2>
        <p className="m-0 text-[17px] text-ink-muted">Quatre promesses, tenues à chaque conversation.</p>
      </div>
      <ul {...rv(1)} className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2 xl:grid-cols-4">
        {SCENES.map((scene, i) => (
          <PromiseCard key={scene.title} scene={scene} open={open === i} onToggle={() => toggle(i)} />
        ))}
      </ul>
      <div id="promise-stage" aria-live="polite">
        {open !== null && (
          <div key={nonce} className="mt-4 rounded-[24px] border border-line bg-sunken px-5 py-6 md:px-8">
            <Exchange scene={SCENES[open]!} />
          </div>
        )}
      </div>
      <div {...rv(2)} className="mt-8 flex flex-col gap-4 rounded-[24px] bg-sunken p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <p className="m-0 text-[16px] text-ink-muted md:max-w-[34ch]">
          Ces promesses sont dans l’interface : chaque réponse cite sa fiche officielle
          <CitationMark index={1} /> et vous gardez la main sur votre accord.
        </p>
        <div aria-hidden="true" inert className="flex flex-wrap items-center gap-3">
          <SourcePill index={1} title="passeport" domain="fiche officielle" />
          <div className="min-w-[300px]">
            <ActCard />
          </div>
        </div>
      </div>
    </div>
  );
}
