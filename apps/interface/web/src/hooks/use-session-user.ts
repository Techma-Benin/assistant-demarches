'use client';

import { useEffect, useState } from 'react';

export type SessionUser = { status: 'checking' | 'guest' | 'user'; name: string | null; signIn: 'npi' | 'oidc' };

/**
 * Who is behind the browser (`GET /api/session`): `user: null` is a guest.
 * `onError` is what a failed request counts as (default a guest; `'user'` lets the API answer instead).
 */
export function useSessionUser({ onError = 'guest' }: { onError?: 'guest' | 'user' } = {}): SessionUser {
  const [session, setSession] = useState<SessionUser>({ status: 'checking', name: null, signIn: 'oidc' });
  useEffect(() => {
    let cancelled = false;
    fetch('/api/session')
      .then((response) => (response.ok ? response.json() : { user: null }))
      .then((data: { user?: { name?: unknown } | null; signIn?: unknown }) => {
        const signIn = data.signIn === 'npi' ? 'npi' : 'oidc';
        if (cancelled) return;
        const user = data.user;
        setSession(user ? { status: 'user', name: typeof user.name === 'string' ? user.name : null, signIn } : { status: 'guest', name: null, signIn });
      })
      .catch(() => {
        if (!cancelled) setSession({ status: onError, name: null, signIn: 'oidc' });
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);
  return session;
}
