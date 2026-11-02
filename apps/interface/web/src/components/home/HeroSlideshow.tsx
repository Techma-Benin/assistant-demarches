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
  },
  {
    src: '/photos/esplanade-amazone-lever-soleil.jpg',
    alt: 'L’esplanade de l’Amazone à Cotonou au lever du soleil, la statue en silhouette',
    title: 'Lever de soleil sur l’Esplanade de l’amazone à Cotonou',
    author: 'Fawaz.tairou',
    licence: 'CC BY-SA 4.0',
    page: 'https://commons.wikimedia.org/wiki/File:Lever_de_soleil_sur_l%27Esplanade_de_l%27amazone_%C3%A0_Cotonou.jpg',
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
    src: '/photos/porte-non-retour-ouidah-nuit.jpg',
    alt: 'La Porte du non-retour à Ouidah, illuminée la nuit',
    title: 'Vue de nuit la porte du non retour a Ouidah 01',
    author: 'Chiemelacebelae',
    licence: 'CC0',
    page: 'https://commons.wikimedia.org/wiki/File:Vue_de_nuit_la_porte_du_non_retour_a_Ouidah_01.jpg',
  },
];

const SLIDE_MS = 6000;

const controlClass =
  'ui-press inline-flex size-11 items-center justify-center rounded-full bg-sunken text-ink hover:bg-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

/** The photo card of the hero and its three round controls (previous, play/pause, next). */
export function HeroSlideshow({ photos = HERO_PHOTOS }: { photos?: HeroPhoto[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const count = photos.length;

  // Reduced motion: start paused (no autoplay, no zoom); the visitor can still press play.
  useEffect(() => {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPaused(true);
  }, []);

  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  // Depending on index restarts the timer after a manual change, so a slide always gets its full time.
  useEffect(() => {
    if (paused || hidden || count < 2) return;
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % count), SLIDE_MS);
    return () => window.clearTimeout(id);
  }, [paused, hidden, index, count]);

  const go = (step: number) => setIndex((i) => (i + step + count) % count);

  return (
    <>
      <div className="mx-auto w-full max-w-[1200px] px-3 md:px-6">
        <div className="relative aspect-[4/5] overflow-hidden rounded-[24px] bg-line sm:aspect-[16/10] md:rounded-[32px] lg:aspect-[16/8]">
          {photos.map((photo, i) => {
            const active = i === index;
            return (
              <Image
                key={photo.src}
                src={photo.src}
                alt={photo.alt}
                fill
                // The card is at most 1152px wide (1200px minus its padding); full width below that.
                sizes="(min-width: 1200px) 1152px, 100vw"
                quality={85}
                priority={i === 0}
                aria-hidden={active ? undefined : true}
                style={photo.position ? { objectPosition: photo.position } : undefined}
                className={cn(
                  'object-cover transition-opacity duration-700 ease-in-out motion-reduce:transition-none',
                  active ? 'opacity-100 motion-safe:animate-[hero-zoom_6s_ease-out_both]' : 'opacity-0',
                )}
              />
            );
          })}
          {/* The flag as a thin edge along the bottom of the photo: our mark on the picture. */}
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 flex h-2">
            <div className="flex-1 bg-(--home-field-green)" />
            <div className="flex-1 bg-sun" />
            <div className="flex-1 bg-flag-red" />
          </div>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-center gap-2">
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
    </>
  );
}
