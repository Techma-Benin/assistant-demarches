'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@techma/ui';

export function FitWord({
  word,
  max = 320,
  maxScreenHeight,
  className,
  style,
}: {
  word: string;
  max?: number;
  maxScreenHeight?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const sizer = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<number | null>(null);

  useLayoutEffect(() => {
    const box = frame.current;
    const span = sizer.current;
    if (!box || !span) return;
    const fit = () => {
      span.style.fontSize = '100px';
      const cap = maxScreenHeight ? Math.min(max, window.innerHeight * maxScreenHeight) : max;
      setSize(Math.min(cap, (100 * box.clientWidth) / span.scrollWidth));
    };
    fit();
    document.fonts?.ready.then(fit);
    window.addEventListener('resize', fit);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(box);
    return () => {
      window.removeEventListener('resize', fit);
      observer?.disconnect();
    };
  }, [word, max, maxScreenHeight]);

  const type = 'block whitespace-nowrap pr-[0.1em] pt-[0.12em] font-display font-extrabold leading-[0.86] tracking-[-0.05em]';
  return (
    <div ref={frame} aria-hidden="true" className="relative select-none text-center" style={{ fontSize: size ? `${size.toFixed(2)}px` : '17vw' }}>
      <span ref={sizer} className={cn(type, 'pointer-events-none absolute left-0 top-0 opacity-0')}>
        {word}
      </span>
      <span className={cn(type, className)} style={style}>
        {word}
      </span>
    </div>
  );
}
