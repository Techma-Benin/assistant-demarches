'use client';

import { useEffect, useState } from 'react';
import { onSessionChanged } from '@/lib/session-events';

export type SessionUser = { status: 'checking' | 'guest' | 'user'; name: string | null; signIn: 'npi' | 'oidc' };

/**
 * Who is behind the browser (`GET /api/session`): `user: null` is a guest.
 * `onError` is what a failed request counts as (default a guest; `'user'` lets the API answer instead).
 */
export function useSessionUser({ onError = 'guest' }: { onError?: 'guest' | 'user' } = {}): SessionUser {
  const [session, setSession] = useState<SessionUser>({ status: 'checking', name: null, signIn: 'oidc' });
  useEffect(() => {
    let unmounted = false;
    let latest = 0;
    // Reads again on each session change without going back to `checking` (no flicker); only the latest read counts.
    const read = () => {
      const id = ++latest;
      const current = () => !unmounted && id === latest;
      fetch('/api/session')
        .then((response) => (response.ok ? response.json() : { user: null }))
        .then((data: { user?: { name?: unknown } | null; signIn?: unknown }) => {
          const signIn = data.signIn === 'npi' ? 'npi' : 'oidc';
          if (!current()) return;
          const user = data.user;
          setSession(user ? { status: 'user', name: typeof user.name === 'string' ? user.name : null, signIn } : { status: 'guest', name: null, signIn });
        })
        .catch(() => {
          if (current()) setSession({ status: onError, name: null, signIn: 'oidc' });
        });
    };
    read();
    const unsubscribe = onSessionChanged(read);
    return () => {
      unmounted = true;
      unsubscribe();
    };
  }, [onError]);
  return session;
}
