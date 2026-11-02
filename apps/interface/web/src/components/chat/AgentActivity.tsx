'use client';

import { useEffect, useState } from 'react';
import { FlagGlyph, cn } from '@techma/ui';

const DOTS = ['bg-trust', 'bg-sun', 'bg-flag-red'] as const;
const FADE_MS = 150;
const SLOW_AFTER_MS = 8000;

/**
 * Visual « the agent is working » line. Purely decorative (aria-hidden): the label is announced once by a
 * separate status region, so the log never contains a nested live region.
 */
export function AgentActivity({ label }: { label: string }) {
  const [shown, setShown] = useState(label);
  const [slow, setSlow] = useState(false);

  // Label changes crossfade: fade the old one out, swap, fade in.
  useEffect(() => {
    if (label === shown) return;
    const timer = window.setTimeout(() => setShown(label), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [label, shown]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div aria-hidden="true" className="flex items-start gap-2.5 py-1 text-ink-muted">
      <FlagGlyph decorative width={22} height={16} className="mt-1 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5">
            {DOTS.map((color, index) => (
              <span
                key={color}
                style={{ animationDelay: `${index * 160}ms` }}
                className={cn(
                  'size-2.5 rounded-full motion-safe:animate-[ui-typing-flag_1.2s_var(--ui-ease-out)_infinite]',
                  color,
                )}
              />
            ))}
          </span>
          <span
            className={cn(
              'text-[15px] transition-opacity duration-150 ease-(--ui-ease-out) motion-reduce:transition-none',
              label === shown ? 'opacity-100' : 'opacity-0',
            )}
          >
            {shown}
          </span>
        </div>
        {slow && <span className="chat-fade-in text-[13px]">Cela prend un peu plus de temps que d’habitude.</span>}
      </div>
    </div>
  );
}
