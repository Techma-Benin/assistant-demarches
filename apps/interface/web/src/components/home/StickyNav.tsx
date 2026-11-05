'use client';

import { ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BrandMark, cn } from '@techma/ui';

export type NavLink = { id: string; label: string };

export function StickyNav({ links, brandFlag, onAsk }: { links: NavLink[]; brandFlag: boolean; onAsk: () => void }) {
  const [shown, setShown] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const bar = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      setShown(window.scrollY > window.innerHeight * 0.75);
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
    <div
      inert={!shown}
      className={cn(
        'fixed inset-x-0 top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md transition-[transform,opacity] duration-300 ease-out',
        shown ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0',
      )}
    >
      <div className="mx-auto flex h-14 max-w-[1320px] items-center justify-between gap-4 px-5 md:px-8">
        <a href="#top" className="inline-flex min-h-11 items-center no-underline">
          <BrandMark showFlag={brandFlag} />
        </a>
        <nav aria-label="Sections de la page" className="hidden items-center gap-1 md:flex">
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
        <button
          type="button"
          onClick={onAsk}
          className="ui-press group inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-pill bg-action px-4 text-[14px] font-semibold text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Poser ma question
          <ArrowRight aria-hidden="true" className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>
      </div>
      <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-[3px] overflow-hidden">
        <span ref={bar} className="block h-full origin-left bg-linear-to-r from-(--home-field-green) via-sun to-flag-red" style={{ transform: 'scaleX(0)' }} />
      </span>
    </div>
  );
}
