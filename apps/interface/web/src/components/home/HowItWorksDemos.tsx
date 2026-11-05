'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { CitationMark, Chip, FlagGlyph, SourcePill, StatusPill, cn } from '@techma/ui';
import { CheckCheck, FileCheck2, Loader, Mic } from 'lucide-react';
import type { Schemas } from '@techma/contracts-ts';
import { AgentActivity } from '@/components/chat/AgentActivity';
import { CaseCardBlock } from '@/components/blocks/CaseCardBlock';
import { Stamp } from './DocumentArt';

type Loop = { ref: RefObject<HTMLDivElement | null>; step: number; animated: boolean };

/**
 * Drives a demo: `steps` are durations in ms, the last one being the fade-out/pause before restarting.
 * Until mounted the hook returns `finalStep`, the complete frame.
 */
export function useDemoLoop(steps: number[], finalStep: number): Loop {
  const ref = useRef<HTMLDivElement>(null);
  const [animated, setAnimated] = useState(false);
  const [step, setStep] = useState(finalStep);
  const [onScreen, setOnScreen] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    setStep(0);
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
  const played = useRef(false);
  if (animated && step !== finalStep) played.current = true;
  useEffect(() => {
    if (!running || (played.current && step === finalStep)) return;
    const timer = window.setTimeout(() => setStep((s) => (s + 1) % steps.length), steps[step]);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, step]);

  return { ref, step, animated };
}

/** Counts 0..max every `ms` while `active`, back to 0 when inactive. */
function useTicker(active: boolean, ms: number, max: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) {
      setN(0);
      return;
    }
    const id = window.setInterval(() => setN((v) => Math.min(v + 1, max)), ms);
    return () => window.clearInterval(id);
  }, [active, ms, max]);
  return n;
}

/** Rise 10px + fade on mount; shown immediately when not animated. */
export function Rise({ animated, children, className, from = 'translate-y-2.5' }: { animated: boolean; children: ReactNode; className?: string; from?: string }) {
  const [on, setOn] = useState(!animated);
  useEffect(() => {
    if (on) return;
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, [on]);
  return (
    <div
      className={cn(
        'transition-[opacity,transform] duration-300 ease-out',
        on ? 'translate-y-0 opacity-100' : cn(from, 'opacity-0'),
        className,
      )}
    >
      {children}
    </div>
  );
}

function Frame({ loop, fading, center, children }: { loop: Loop; fading: boolean; center?: boolean; children: ReactNode }) {
  return (
    <div
      ref={loop.ref}
      aria-hidden="true"
      inert
      className={cn('pointer-events-none absolute inset-0 flex flex-col overflow-hidden p-5 lg:p-6', center ? 'justify-center' : 'justify-end')}
    >
      <div className={cn('flex flex-col gap-3 transition-opacity duration-300 ease-out', fading ? 'opacity-0' : 'opacity-100', center && 'h-full justify-center')}>
        {children}
      </div>
    </div>
  );
}

function Cursor({ show, near, tap, className, style }: { show: boolean; near: boolean; tap?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <span
      style={style}
      className={cn(
        'absolute left-1/2 top-1/2 z-10 size-4 rounded-full border-2 border-white bg-ink/80 shadow-md transition-[transform,opacity] duration-[650ms] ease-out',
        near ? 'translate-x-2 translate-y-1' : 'translate-x-24 translate-y-16',
        show ? 'opacity-100' : 'opacity-0',
        tap && 'scale-90',
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------- 1. Ask

const ASK_TEXT = 'Il me faut un acte de naissance pour mon fils';
const ASK_STEPS = [600, ASK_TEXT.length * 35 + 300, 1300, 3400, 500, 700];
const ASK_FINAL = 3;

export function AskDemo() {
  const loop = useDemoLoop(ASK_STEPS, ASK_FINAL);
  const { step, animated } = loop;
  const typed = useTicker(animated && step === 1, 35, ASK_TEXT.length);
  const sent = step >= 2 && step <= 4;
  const fading = step === 4;
  return (
    <Frame loop={loop} fading={fading}>
      {sent && (
        <Rise animated={animated} className="flex flex-col items-end gap-1">
          <div className="max-w-[90%] rounded-[24px] bg-surface px-5 py-3 text-[16px] font-medium leading-[1.45]">{ASK_TEXT}</div>
          {step >= 2 && (
            <div className="flex items-center gap-1 text-[13px] text-ink-muted">
              <CheckCheck aria-hidden="true" className="size-3.5" />
              Reçu
            </div>
          )}
        </Rise>
      )}
      {step >= 3 && step <= 4 && (
        <Rise animated={animated}>
          <AgentActivity label="Je consulte la fiche officielle…" />
        </Rise>
      )}
      <div className="flex min-h-12 items-center gap-2 rounded-pill bg-white px-5 py-2 text-[15px] text-black">
        <span className="min-w-0 flex-1 truncate">
          {step === 1 ? (
            <>
              {ASK_TEXT.slice(0, typed)}
              <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-black" />
            </>
          ) : (
            <span className="text-black/50">Posez votre question…</span>
          )}
        </span>
        <Mic aria-hidden="true" className="size-5 shrink-0 text-black/60" />
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------- 2. Prepare

const ANSWER = 'Selon la fiche officielle, il faut la copie de l’acte de la mère et une pièce d’identité.'.split(' ');
const PREPARE_STEPS = [400, ANSWER.length * 110 + 300, 800, 800, 800, 400, 3400, 500];
const PREPARE_FINAL = 6;

// Illustrative data only (simulated case), typed with the v2 contract.
const DEMO_CARD: { type: 'caseCard'; case: Schemas['Case'] } = {
  type: 'caseCard',
  case: {
    id: 'cas_01JD0000000000000000000000',
    reference: 'SIM-ANIP-2026-000000',
    simulated: true,
    procedureId: 'PS00393',
    title: 'Acte de naissance sécurisé',
    administrationId: 'anip',
    applicantRef: 'usr_01JD0000000000000000000000',
    requestId: 'req_01JD0000000000000000000000',
    channel: 'web',
    status: 'received',
    fields: {},
    documents: [],
    payment: { amountFcfa: 0, status: 'not_required', reference: null, paidAt: null, simulated: true },
    steps: [{ id: 'depot', label: 'Dossier déposé par l’assistant', state: 'done', actor: 'assistant', note: null, at: '2026-11-01T09:00:00Z' }],
    informationRequest: null,
    claimedBy: null,
    completedBy: null,
    decisionNote: null,
    createdAt: '2026-11-01T09:00:00Z',
    updatedAt: '2026-11-01T09:00:00Z',
  },
};

export function PrepareDemo() {
  const loop = useDemoLoop(PREPARE_STEPS, PREPARE_FINAL);
  const { step, animated } = loop;
  const words = useTicker(animated && step === 1, 110, ANSWER.length);
  const shownWords = !animated || step >= 2 ? ANSWER.length : words;
  const created = step >= 6 && step <= 7;
  const chip = step >= 3 && step <= 5;
  return (
    <Frame loop={loop} fading={step === 7}>
      {step >= 1 && step <= 5 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <FlagGlyph decorative width={22} height={16} className="shrink-0" />
            <span className="text-[14px] font-semibold text-ink">Assistant Démarches</span>
          </div>
          <p className="m-0 text-[16px] leading-[1.45] text-ink">
            {ANSWER.slice(0, shownWords).join(' ')}
            {step >= 2 && <CitationMark index={1} />}
          </p>
          {step >= 2 && (
            <Rise animated={animated}>
              <SourcePill index={1} title="acte-naissance" domain="fiche officielle" />
            </Rise>
          )}
        </div>
      )}
      {chip && (
        <Rise animated={animated} className="relative self-start">
          <Chip tabIndex={-1} className={cn('text-[15px] transition-transform duration-200', step === 5 && 'scale-[0.96]')}>
            Préparer ma demande
          </Chip>
          <Cursor show={step >= 4} near={step >= 4} tap={step === 5} />
        </Rise>
      )}
      {created && (
        <Rise animated={animated} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-trust-soft text-trust-text">
              <FileCheck2 aria-hidden="true" className="size-3.5" />
            </span>
            <span className="text-[15px] font-semibold text-ink">Demande créée</span>
          </div>
          <CaseCardBlock block={DEMO_CARD} />
        </Rise>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------- 3. Validate

const VALIDATE_STEPS = [900, 800, 350, 1000, 3200, 500, 400];
const VALIDATE_FINAL = 4;

export function ValidateDemo() {
  const loop = useDemoLoop(VALIDATE_STEPS, VALIDATE_FINAL);
  const { step, animated } = loop;
  const done = step === 4 || step === 5;
  const busy = step === 3;
  return (
    <Frame loop={loop} fading={step >= 5} center>
      <div className="relative mx-auto flex h-[88%] w-[82%] flex-col justify-between gap-4 overflow-hidden rounded-[20px] bg-surface p-5 text-ink shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
          <span className="text-[15px] font-semibold">Portail officiel</span>
          <StatusPill status={done ? 'submitted' : 'toValidate'}>
            {done ? 'Déposée' : 'Prêt à valider'}
          </StatusPill>
        </div>
        <div className="flex flex-col gap-1.5 text-[15px]">
          <p className="m-0 text-[20px] font-bold">Acte de naissance</p>
          <p className="m-0 text-ink-muted">Demandeur : Usager fictif</p>
          <p className="m-0 text-ink-muted">Pièces : 2 jointes</p>
        </div>
        <div className="relative self-start">
          <span
            className={cn(
              'inline-flex min-h-11 items-center gap-2 rounded-pill bg-black px-6 text-[15px] font-bold text-white transition-transform duration-200',
              step === 2 && 'scale-[0.96]',
              done && 'opacity-40',
            )}
          >
            {busy ? <Loader aria-hidden="true" className="size-4 animate-spin" /> : null}
            {busy ? 'Envoi…' : 'Valider ma demande'}
          </span>
          <Cursor show={step >= 1 && step <= 2} near={step >= 1} tap={step === 2} />
        </div>
        {done && <StampLanding animated={animated} />}
      </div>
    </Frame>
  );
}

/** Stamp lands on the panel: scale 1.3 to 1, rotated -12deg, fading in. */
function StampLanding({ animated }: { animated: boolean }) {
  const [on, setOn] = useState(!animated);
  useEffect(() => {
    if (on) return;
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, [on]);
  return (
    <Stamp
      className={cn(
        'absolute bottom-3 right-4 size-24 -rotate-12 transition-[transform,opacity] duration-[400ms] ease-out',
        on ? 'scale-100 opacity-100' : 'scale-[1.3] opacity-0',
      )}
    />
  );
}
