'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import type { StreamStatus } from '@/lib/conversation-stream';

const UNSTABLE_DELAY_MS = 3000;

// Shown under the header: after 3 s of "connecting"/"polling" (no flicker on startup or a quick
// reconnect), immediately when offline, never when live.
export function ConnectionNotice({ connection }: { connection: StreamStatus }) {
  const unstable = connection === 'polling' || connection === 'connecting';
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    setElapsed(false);
    if (!unstable) return;
    const timer = setTimeout(() => setElapsed(true), UNSTABLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [unstable]);

  const base = 'flex items-center gap-2 px-4 py-2 text-[13px]';
  if (connection === 'offline') {
    return (
      <div role="status" className={`${base} bg-sunken text-ink-muted`}>
        <WifiOff aria-hidden="true" className="size-3.5 shrink-0" />
        Vous êtes hors ligne. La conversation reprendra à la reconnexion.
      </div>
    );
  }
  if (unstable && elapsed) {
    return (
      <div role="status" className={`${base} bg-warning-soft text-warning`}>
        <RefreshCw aria-hidden="true" className="size-3.5 shrink-0 motion-safe:animate-spin" />
        Connexion instable, reconnexion en cours…
      </div>
    );
  }
  return null;
}
