'use client';

import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { cn } from '@techma/ui';

export type HeroPhoto = {
  src: string;
  alt: string;
  title: string;
  author: string;
  licence: string;
  page: string;
  /** `object-position` keeping the subject in frame on wide crops. */
  position?: string;
};

export const HERO_PHOTOS: HeroPhoto[] = [
  {
    src: '/photos/monument-amazone-cotonou.jpg',
    alt: 'La statue de l’Amazone, à Cotonou, sous un ciel bleu',
    title: 'Le monument de l’Amazone',
    author: 'Mister Kolson',
    licence: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Le_monument_de_l%27Amazone.jpg',
    position: '50% 0%',
  },
  {
    src: '/photos/pirogue-ganvie.jpg',
    alt: 'Une pirogue à voile sur le lac Nokoué, à Ganvié',
    title: 'Pirogue à voile sur le fleuve de Ganvié',
    author: 'Adoscam',
    licence: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Pirogue_%C3%A0_voile_ou_pirogue_%C3%A0_balancier_de_type_b%C3%A9ninois_sur_le_fleuve_de_Ganvi%C3%A9_05.jpg',
    position: '42% 50%',
  },
  {
    src: '/photos/esplanade-amazone-lever-soleil.jpg',
    alt: 'L’esplanade de l’Amazone à Cotonou au lever du soleil, la statue en silhouette',
    title: 'Lever de soleil sur l’Esplanade de l’amazone à Cotonou',
    author: 'Fawaz.tairou',
    licence: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Lever_de_soleil_sur_l%27Esplanade_de_l%27amazone_%C3%A0_Cotonou.jpg',
    position: '48% 69%',
  },
  {
    src: '/photos/vieux-pont-grand-popo.jpg',
    alt: 'Un vieux pont métallique couleur rouille, à Grand-Popo',
    title: 'Un vieux pont à Grand-Popo au Bénin',
    author: 'Adoscam',
    licence: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Un_vieux_pont_%C3%A0_Grand-Popo_au_B%C3%A9nin.jpg',
  },
  {
    src: '/photos/porte-non-retour-ouidah.jpg',
    alt: 'La Porte du non-retour à Ouidah, face à l’océan, sous un ciel bleu',
    title: 'Porte du non retour 1',
    author: 'MathieuC26',
    licence: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Porte_du_non_retour_1.jpg',
    position: '62% 50%',
  },
];

const SLIDE_MS = 6000;

const controlClass =
  'ui-press inline-flex size-11 items-center justify-center rounded-full bg-surface/90 text-ink shadow-[0_2px_10px_rgb(0_0_0/0.18)] backdrop-blur-sm hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

/** The photo card of the hero and its three round controls (previous, play/pause, next). */
export function HeroSlideshow({ photos = HERO_PHOTOS, className }: { photos?: HeroPhoto[]; className?: string }) {
  const [{ index, prev }, setSlide] = useState({ index: 0, prev: -1 });
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const count = photos.length;
  const playState = paused || hidden ? 'paused' : 'running';

  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const go = (step: number) => setSlide((s) => ({ index: (s.index + step + count) % count, prev: s.index }));

  return (
    <div className={cn('mx-auto flex w-full max-w-[1320px] px-3 md:px-6', className)}>
      <div className="hero-card relative w-full flex-1 overflow-hidden rounded-[24px] bg-line md:rounded-[32px]">
        {photos.map((photo, i) => {
          const active = i === index;
          return (
            <Image
              key={photo.src}
              src={photo.src}
              alt={photo.alt}
              fill
              sizes="(min-width: 1200px) 1152px, (min-width: 768px) calc(100vw - 48px), calc(100vw - 24px)"
              quality={85}
              preload={i === 0}
              loading={i === 0 ? 'eager' : undefined}
              aria-hidden={active ? undefined : true}
              style={{ objectPosition: photo.position, animationPlayState: active ? playState : undefined }}
              className={cn(
                'object-cover transition-opacity duration-1000 ease-out',
                active ? 'opacity-100' : 'opacity-0',
                (active || i === prev) && 'animate-[hero-zoom_7s_ease-out_both]',
              )}
            />
          );
        })}
        {count > 1 && (
          <>
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-b from-black/30 to-transparent" />
            <div aria-hidden="true" className="hero-controls absolute inset-x-4 top-11 flex gap-1.5 md:inset-x-6 md:top-12 lg:top-5">
              {photos.map((photo, i) => (
                <div key={photo.src} className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/40">
                  {i === index ? (
                    <div
                      key={`on-${index}`}
                      onAnimationEnd={() => go(1)}
                      style={{ animationDuration: `${SLIDE_MS}ms`, animationPlayState: playState }}
                      className="hero-progress absolute inset-0 origin-left bg-white"
                    />
                  ) : (
                    <div className={cn('absolute inset-0 origin-left bg-white', i < index ? 'scale-x-100' : 'scale-x-0')} />
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 flex h-2">
          <div className="flex-1 bg-(--home-field-green)" />
          <div className="flex-1 bg-sun" />
          <div className="flex-1 bg-flag-red" />
        </div>
        <div className="hero-controls absolute bottom-5 right-4 flex items-center gap-2 md:bottom-6 md:right-6">
          <button type="button" aria-label="Photo précédente" onClick={() => go(-1)} className={controlClass}>
            <ChevronLeft aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            aria-label={paused ? 'Lire le diaporama' : 'Mettre le diaporama en pause'}
            onClick={() => setPaused((p) => !p)}
            className={controlClass}
          >
            {paused ? <Play aria-hidden="true" className="size-5" /> : <Pause aria-hidden="true" className="size-5" />}
          </button>
          <button type="button" aria-label="Photo suivante" onClick={() => go(1)} className={controlClass}>
            <ChevronRight aria-hidden="true" className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
