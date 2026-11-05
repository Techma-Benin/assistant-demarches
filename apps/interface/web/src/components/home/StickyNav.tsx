'use client';

import { ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BrandMark, ThemeToggle, cn } from '@techma/ui';

export type NavLink = { id: string; label: string };

export function StickyNav({ links, brandFlag, onAsk }: { links: NavLink[]; brandFlag: boolean; onAsk: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const bar = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      setScrolled(window.scrollY > 8);
      setPastHero(window.scrollY > window.innerHeight * 0.75);
      if (bar.current) bar.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
      const middle = window.innerHeight * 0.4;
      let current: string | null = null;
      for (const { id } of links) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= middle) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [links]);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-40 transition-[background-color,border-color,box-shadow] duration-300 ease-out',
        scrolled ? 'border-b border-line bg-canvas/85 backdrop-blur-md' : 'border-b border-transparent bg-canvas',
      )}
    >
      <div
        className={cn(
          'mx-auto flex max-w-[1320px] items-center justify-between gap-4 px-5 transition-[height] duration-300 ease-out md:px-8',
          scrolled ? 'h-14' : 'h-16 md:h-[72px]',
        )}
      >
        <a href="#top" className="inline-flex min-h-11 items-center no-underline">
          <BrandMark showFlag={brandFlag} />
        </a>
        <div className="flex min-w-0 items-center gap-1">
          <nav aria-label="Navigation principale" className="hidden items-center gap-1 md:flex">
            {links.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                aria-current={active === link.id ? 'location' : undefined}
                className={cn(
                  'relative inline-flex min-h-11 items-center px-3 text-[15px] font-medium no-underline transition-colors duration-200',
                  active === link.id ? 'text-ink' : 'text-ink-muted hover:text-ink',
                )}
              >
                {link.label}
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-x-3 bottom-1.5 h-0.5 origin-left rounded-full bg-(--home-field-green) transition-transform duration-300',
                    active === link.id ? 'scale-x-100' : 'scale-x-0',
                  )}
                />
              </a>
            ))}
          </nav>
          <ThemeToggle />
          <button
            type="button"
            onClick={onAsk}
            tabIndex={pastHero ? undefined : -1}
            aria-hidden={pastHero ? undefined : true}
            className={cn(
              'ui-press group ml-1 inline-flex min-h-10 shrink-0 items-center gap-1.5 overflow-hidden rounded-pill bg-action text-[14px] font-semibold text-on-action transition-[max-width,opacity,padding] duration-300 ease-out hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              pastHero ? 'max-w-[220px] px-4 opacity-100' : 'pointer-events-none max-w-0 px-0 opacity-0',
            )}
          >
            <span className="whitespace-nowrap">Poser ma question</span>
            <ArrowRight aria-hidden="true" className="size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
      <span aria-hidden="true" className={cn('absolute inset-x-0 -bottom-px h-[3px] overflow-hidden transition-opacity duration-300', scrolled ? 'opacity-100' : 'opacity-0')}>
        <span ref={bar} className="block h-full origin-left bg-linear-to-r from-(--home-field-green) via-sun to-flag-red" style={{ transform: 'scaleX(0)' }} />
      </span>
    </header>
  );
}
