import type { Schemas } from '@techma/contracts-ts';
import { getAuthConfig } from './config';

export const NPI_PATTERN = /^[0-9]{1,20}$/;
export const NPI_CODE_PATTERN = /^[0-9]{1,12}$/;

/** Simulated NPI sign-in for citizens (Keycloak stays for /admin and /operateur). */
export const npiLoginEnabled = (): boolean => process.env.NPI_SIMULATED_LOGIN === 'on';

/** Statuses passed through to the browser; anything else becomes 503. */
const PASS_THROUGH = new Set([400, 401, 429]);

export type NpiResult<T> = { ok: true; body: T } | { ok: false; status: 400 | 401 | 429 | 503 };

async function post<T>(path: string, payload: unknown, isValid: (body: Partial<T>) => boolean): Promise<NpiResult<T>> {
  try {
    const response = await fetch(new URL(path, getAuthConfig().backendUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (PASS_THROUGH.has(response.status)) return { ok: false, status: response.status as 400 | 401 | 429 };
    if (response.status !== 200 && response.status !== 201) return { ok: false, status: 503 };
    const body = (await response.json()) as Partial<T>;
    return isValid(body) ? { ok: true, body: body as T } : { ok: false, status: 503 };
  } catch {
    return { ok: false, status: 503 };
  }
}

const isString = (value: unknown): value is string => typeof value === 'string';

export const startNpiChallenge = (npi: string) =>
  post<Schemas['NpiChallenge']>('/v1/identity/npi', { npi }, (b) => isString(b.challengeToken) && isString(b.expiresAt));

export const verifyNpiCode = (challengeToken: string, code: string) =>
  post<Schemas['NpiSession']>('/v1/identity/npi/verify', { challengeToken, code }, (b) => isString(b.token) && isString(b.expiresAt));
