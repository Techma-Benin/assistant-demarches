const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Shared guard: no token in production, and `mock-*` tokens only towards a loopback backend. */
export function assertTokenAllowed(token: string | undefined, missing = 'MOCK_ADMIN_TOKEN manquant'): string {
  if (process.env.NODE_ENV === 'production') {
    // TODO: échanger la session OIDC de l'administrateur contre un jeton à durée courte
    // portant `admin:read` / `admin:write` et `administrationId` (CONTRACTS.md §3).
    throw new Error('Session OIDC administrateur non branchée');
  }
  if (!token) throw new Error(missing);
  if (token.startsWith('mock-')) {
    const backendUrl = process.env.BACKEND_URL;
    const host = backendUrl ? new URL(backendUrl).hostname : '';
    // new URL('http://[::1]').hostname === '[::1]'
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new Error('Jeton de simulation interdit hors localhost');
    }
  }
  return token;
}

export function getAdminToken(): string {
  return assertTokenAllowed(process.env.MOCK_ADMIN_TOKEN);
}
