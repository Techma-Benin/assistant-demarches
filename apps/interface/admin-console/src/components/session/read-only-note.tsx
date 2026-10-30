'use client';

import { Lock } from 'lucide-react';
import { useSession } from './session-context';

/** Explains why write controls are disabled. */
export function ReadOnlyNote() {
  const { identity } = useSession();
  return (
    <p role="note" className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
      <Lock aria-hidden="true" className="size-4 shrink-0" />
      {`Lecture seule avec l’identité ${identity?.label ?? ''}.`}
    </p>
  );
}
