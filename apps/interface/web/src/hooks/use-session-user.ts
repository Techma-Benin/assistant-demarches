'use client';

import { useEffect, useState } from 'react';

export type SessionUser = { status: 'checking' | 'guest' | 'user'; name: string | null };

/**
 * Who is behind the browser (`GET /api/session`): `user: null` is a guest.
 * `onError` is what a failed request counts as (default a guest; `'user'` lets the API answer instead).
 */
export function useSessionUser({ onError = 'guest' }: { onError?: 'guest' | 'user' } = {}): SessionUser {
  const [session, setSession] = useState<SessionUser>({ status: 'checking', name: null });
  useEffect(() => {
    let cancelled = false;
    fetch('/api/session')
      .then((response) => (response.ok ? response.json() : { user: null }))
      .then((data: { user?: { name?: unknown } | null }) => {
        if (cancelled) return;
        const user = data.user;
        setSession(user ? { status: 'user', name: typeof user.name === 'string' ? user.name : null } : { status: 'guest', name: null });
      })
      .catch(() => {
        if (!cancelled) setSession({ status: onError, name: null });
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);
  return session;
}
