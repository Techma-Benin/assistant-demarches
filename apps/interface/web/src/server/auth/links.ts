import { getAuthConfig } from './config';

export const CONVERSATION_ID = /^cnv_[0-9A-HJKMNP-TV-Z]{26}$/;

/** Same-origin relative path only: starts with `/`, not `//`, no backslash or control character. */
export function safeReturnTo(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return fallback;
  return value;
}

/** Redirect to a path of this app, built on PUBLIC_URL (the request's own host may be an internal bind address). */
export function redirectToApp(path: string, status: 302 | 303 = 302, params?: Record<string, string>): Response {
  const url = new URL(path, getAuthConfig().publicUrl);
  for (const [name, value] of Object.entries(params ?? {})) url.searchParams.set(name, value);
  return new Response(null, {
    status,
    headers: { location: url.toString(), 'cache-control': 'no-store' },
  });
}
