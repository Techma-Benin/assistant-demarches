'use client';

import { InlineAlert, Toast } from '@techma/ui';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { activeIdentity, can as canDo, type Capability, type Identity, type Session } from '@/lib/permissions';
import { newTraceparent } from '@/lib/trace';
import { useToast } from '../use-toast';

interface SessionValue {
  session: Session | null;
  identity: Identity | null;
  can: (capability: Capability) => boolean;
  switchIdentity: (identityId: string) => Promise<void>;
  switching: boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

const SWITCH_FAILED = 'Impossible de changer d’identité. Réessayez.';
const ERROR_DURATION = 6000;

async function failureDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string' && body.detail !== '') return body.detail;
  } catch {
    // not a problem+json body
  }
  return SWITCH_FAILED;
}

/** Holds the session read by the server layout; `initial` is null when it could not be established. */
export function SessionProvider({ initial, children }: { initial: Session | null; children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState(initial);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const switchingRef = useRef(false);
  const toast = useToast();
  const identity = activeIdentity(session);

  useEffect(() => {
    if (error === null) return;
    const timer = setTimeout(() => setError(null), ERROR_DURATION);
    return () => clearTimeout(timer);
  }, [error]);

  const switchIdentity = useCallback(
    async (identityId: string) => {
      if (switchingRef.current) return;
      switchingRef.current = true;
      setSwitching(true);
      setError(null);
      try {
        const response = await fetch('/api/session/identity', {
          method: 'POST',
          headers: { 'content-type': 'application/json', traceparent: newTraceparent() },
          body: JSON.stringify({ identityId }),
        });
        if (!response.ok) {
          setError(await failureDetail(response));
          return;
        }
        const next = (await response.json()) as Session;
        setSession(next);
        router.push('/');
        router.refresh();
        const label = activeIdentity(next)?.label ?? '';
        toast.show(`Vous agissez maintenant en tant que : ${label}`);
      } catch {
        setError(SWITCH_FAILED);
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    },
    [router, toast.show],
  );

  const value = useMemo<SessionValue>(
    () => ({ session, identity, can: (capability) => canDo(identity, capability), switchIdentity, switching }),
    [session, identity, switchIdentity, switching],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
        <Toast message={toast.message} onDismiss={toast.dismiss} className="pointer-events-auto" />
        {error ? <InlineAlert className="pointer-events-auto max-w-[460px] shadow-(--ui-shadow-pop)">{error}</InlineAlert> : null}
      </div>
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}
