'use client';

import { ArrowRight, ArrowUp, ChevronLeft, ChevronRight, Mic, Pause, Paperclip, Play } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Button, cn } from '@techma/ui';
import { DocumentArt, type DocumentKind } from './DocumentArt';

export type CarouselItem = { name: string; kind: DocumentKind; question: string; detail: string };

const STEP_MS = 4500;
const SWIPE_PX = 40;

const controlClass =
  'ui-press inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line text-ink-muted hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const FIELDS = ['bg-(--home-field-green)', 'bg-sunken', 'bg-(--home-field-sun)', 'bg-sunken'];

function signedOffset(i: number, index: number, count: number) {
  const raw = (i - index + count) % count;
  return raw > count / 2 ? raw - count : raw;
}

function Card({ item, field, onField, onSend, disabled }: { item: CarouselItem; field: string; onField: boolean; onSend?: () => void; disabled?: boolean }) {
  return (
    <div className={cn('relative size-full overflow-hidden rounded-[24px] md:rounded-[32px]', field)}>
      <div aria-hidden="true" className="absolute -right-[12%] top-1/2 aspect-square h-[120%] -translate-y-1/2 rounded-full bg-canvas/25" />
      <DocumentArt
        kind={item.kind}
        className="absolute bottom-[20%] right-[10%] h-[52%] w-auto rotate-[4deg] drop-shadow-[0_18px_30px_rgb(0_0_0/0.18)] sm:bottom-auto sm:right-[8%] sm:top-[10%] sm:h-[78%]"
      />
      <div className="absolute left-5 right-5 top-5 sm:right-auto sm:max-w-[52%] md:left-8 md:top-8">
        <p className={cn('m-0 font-display text-[clamp(24px,3vw,40px)] font-extrabold leading-[1.02] tracking-[-0.035em]', onField ? 'text-on-trust' : 'text-ink')}>
          {item.name}
        </p>
        <p className={cn('m-0 mt-2 hidden text-[15px] leading-snug sm:block', onField ? 'text-on-trust/85' : 'text-ink-muted')}>{item.detail}</p>
      </div>
      <div
        className={cn(
          'absolute inset-x-4 bottom-4 flex items-center gap-2 rounded-[20px] bg-surface/95 p-2 pl-4 shadow-[0_10px_30px_rgb(0_0_0/0.14)] md:inset-x-auto md:bottom-8 md:left-8',
          onSend ? 'md:w-[min(66%,500px)]' : 'md:w-[min(56%,420px)]',
        )}
      >
        {onSend ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onSend}
            aria-label={`Envoyer à l’assistant : ${item.question}`}
            className="m-0 min-h-11 min-w-0 flex-1 cursor-pointer truncate rounded-[12px] text-left text-[15px] text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed"
          >
            {item.question}
          </button>
        ) : (
          <p className="m-0 min-w-0 flex-1 truncate text-[15px] text-ink">{item.question}</p>
        )}
        {!onSend && (
          <>
            <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-muted">
              <Paperclip className="size-5" />
            </span>
            <span aria-hidden="true" className="hidden size-9 shrink-0 items-center justify-center rounded-full text-ink-muted sm:inline-flex">
              <Mic className="size-5" />
            </span>
          </>
        )}
        {onSend ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onSend}
            aria-label={`Envoyer à l’assistant : ${item.question}`}
            className="ui-press group inline-flex size-12 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-pill bg-action text-[15px] font-semibold text-on-action shadow-[0_6px_18px_rgb(0_0_0/0.22)] ring-4 ring-action/15 hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-5"
          >
            <span className="hidden sm:inline">Envoyer</span>
            <ArrowUp aria-hidden="true" className="size-5 transition-transform duration-200 group-enabled:group-hover:-translate-y-0.5" />
          </button>
        ) : (
          <span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-action text-on-action">
            <ArrowUp className="size-5" />
          </span>
        )}
      </div>
    </div>
  );
}

export function DocumentCarousel({ items, disabled, onAsk }: { items: CarouselItem[]; disabled?: boolean; onAsk: (question: string) => void }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const swipeFrom = useRef<number | null>(null);
  const count = items.length;
  const current = items[index]!;

  useEffect(() => {
    const sync = () => setPageVisible(document.visibilityState !== 'hidden');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (paused || !onScreen || !pageVisible || count < 2) return;
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % count), STEP_MS);
    return () => window.clearTimeout(id);
  }, [paused, onScreen, pageVisible, index, count]);

  const go = (step: number) => setIndex((i) => (i + step + count) % count);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else return;
    e.preventDefault();
  };

  const onPointerDown = (e: PointerEvent) => {
    swipeFrom.current = e.clientX;
  };
  const onPointerUp = (e: PointerEvent) => {
    const from = swipeFrom.current;
    swipeFrom.current = null;
    if (from === null) return;
    const dx = e.clientX - from;
    if (Math.abs(dx) >= SWIPE_PX) go(dx < 0 ? 1 : -1);
  };

  return (
    <div
      role="region"
      aria-roledescription="carrousel"
      aria-label="Documents que l’assistant vous aide à obtenir"
      onKeyDown={onKey}
    >
      <div
        ref={stage}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipeFrom.current = null)}
        className="relative grid touch-pan-y [grid-template-areas:'s'] [perspective:1800px]"
      >
        {items.map((item, i) => {
          const offset = signedOffset(i, index, count);
          const distance = Math.abs(offset);
          const visible = distance <= 1;
          const field = FIELDS[i % FIELDS.length]!;
          const style: CSSProperties = {
            transform: `translateX(${offset * 96}%) rotateY(${offset * -14}deg) scale(${offset === 0 ? 1 : 0.86})`,
            opacity: distance > 1 ? 0 : 1,
            zIndex: 10 - distance,
          };
          return (
            <div
              key={item.kind}
              role="group"
              aria-roledescription="diapositive"
              aria-label={`${i + 1} sur ${count} : ${item.name}`}
              aria-hidden={offset === 0 ? undefined : true}
              style={style}
              className={cn(
                'aspect-[4/5] w-[min(84vw,760px)] justify-self-center [grid-area:s] sm:aspect-[16/10] lg:aspect-[16/9]',
                'transition-[transform,opacity,filter] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
                offset !== 0 && 'blur-[2px] saturate-[0.7]',
                distance > 1 && 'pointer-events-none',
              )}
            >
              {visible && offset !== 0 ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Afficher ${item.name}`}
                  onClick={() => setIndex(i)}
                  className="size-full cursor-pointer text-left"
                >
                  <Card item={item} field={field} onField={field === FIELDS[0]} />
                </button>
              ) : (
                <Card
                  item={item}
                  field={field}
                  onField={field === FIELDS[0]}
                  disabled={disabled}
                  onSend={offset === 0 ? () => onAsk(item.question) : undefined}
                />
              )}
            </div>
          );
        })}
        <button
          type="button"
          aria-label="Document précédent"
          onClick={() => go(-1)}
          className={cn(controlClass, 'absolute left-2 top-1/2 z-20 hidden -translate-y-1/2 border-transparent bg-surface/90 text-ink shadow-md hover:bg-surface md:inline-flex lg:left-[6%]')}
        >
          <ChevronLeft aria-hidden="true" className="size-5" />
        </button>
        <button
          type="button"
          aria-label="Document suivant"
          onClick={() => go(1)}
          className={cn(controlClass, 'absolute right-2 top-1/2 z-20 hidden -translate-y-1/2 border-transparent bg-surface/90 text-ink shadow-md hover:bg-surface md:inline-flex lg:right-[6%]')}
        >
          <ChevronRight aria-hidden="true" className="size-5" />
        </button>
      </div>

      <div className="mx-auto mt-6 flex w-[min(84vw,760px)] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p aria-live="polite" className="m-0 min-w-0 text-[17px] leading-snug">
          <span className="font-semibold">« {current.question} »</span>{' '}
          <span className="text-ink-muted">Pièces, coût et délai, d’après la fiche officielle.</span>
        </p>
        <Button
          disabled={disabled}
          onClick={() => onAsk(current.question)}
          aria-label={`Poser cette question à l’assistant : ${current.question}`}
          className="group w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:w-auto"
          trailingIcon={<ArrowRight aria-hidden="true" className="size-5 transition-transform duration-200 group-enabled:group-hover:translate-x-1" />}
        >
          <span>
            Poser cette question<span className="hidden md:inline"> à l’assistant</span>
          </span>
        </Button>
      </div>
      <div className="mx-auto mt-3 flex w-[min(84vw,760px)] items-center gap-2">
        <button type="button" aria-label="Document précédent" onClick={() => go(-1)} className={cn(controlClass, 'md:hidden')}>
          <ChevronLeft aria-hidden="true" className="size-5" />
        </button>
        <div aria-hidden="true" className="flex min-w-0 flex-1 gap-1.5">
          {items.map((item, i) => (
            <span key={item.kind} className="h-1 flex-1 overflow-hidden rounded-full bg-line">
              <span
                key={i === index ? `on-${index}` : 'off'}
                className={cn(
                  'block h-full rounded-full bg-ink',
                  i === index ? (paused ? 'w-full' : 'w-full origin-left animate-[carousel-progress_4500ms_linear_both]') : i < index ? 'w-full opacity-40' : 'w-0',
                )}
              />
            </span>
          ))}
        </div>
        <button
          type="button"
          aria-label={paused ? 'Lire le carrousel' : 'Mettre le carrousel en pause'}
          onClick={() => setPaused((p) => !p)}
          className={controlClass}
        >
          {paused ? <Play aria-hidden="true" className="size-5" /> : <Pause aria-hidden="true" className="size-5" />}
        </button>
        <button type="button" aria-label="Document suivant" onClick={() => go(1)} className={cn(controlClass, 'md:hidden')}>
          <ChevronRight aria-hidden="true" className="size-5" />
        </button>
      </div>
    </div>
  );
}
