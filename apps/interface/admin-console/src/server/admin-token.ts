const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function getAdminToken(): string {
  if (process.env.NODE_ENV === 'production') {
    // TODO: échanger la session OIDC de l'administrateur contre un jeton à durée courte
    // portant `admin:read` / `admin:write` et `administrationId` (CONTRACTS.md §3).
    throw new Error('Session OIDC administrateur non branchée');
  }
  const token = process.env.MOCK_ADMIN_TOKEN;
  if (!token) throw new Error('MOCK_ADMIN_TOKEN manquant');
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
