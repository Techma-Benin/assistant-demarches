import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { vi } from 'vitest';
import { resetAuthConfigForTests } from '@/server/auth/config';
import { resetOidcForTests } from '@/server/auth/oidc';

export const PUBLIC_URL = 'http://127.0.0.1:3000';
export const BACKEND_URL = 'http://127.0.0.1:4010';
export const ISSUER = 'http://127.0.0.1:8080/realms/techma';
export const CNV = 'cnv_' + '0'.repeat(25) + '1';

// ---- cookies() mock -------------------------------------------------------

export interface SetCall {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

export const jar = new Map<string, string>();
export const setCalls: SetCall[] = [];

const store = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  has: (name: string) => jar.has(name),
  set: (name: string, value: string, options: Record<string, unknown> = {}) => {
    jar.set(name, value);
    setCalls.push({ name, value, options });
  },
  delete: (name: string) => {
    jar.delete(name);
  },
};

/** Factory for `vi.mock('next/headers', ...)`. */
export const headersMock = () => ({ cookies: async () => store });

export function resetCookies(): void {
  jar.clear();
  setCalls.length = 0;
}

// ---- environment ----------------------------------------------------------

let tempDir: string | null = null;

export function setupAuthEnv(overrides: Record<string, string> = {}): void {
  tempDir = mkdtempSync(join(tmpdir(), 'ad-auth-test-'));
  const keyFile = join(tempDir, 'session.key');
  writeFileSync(keyFile, randomBytes(32).toString('base64url'));
  const env: Record<string, string> = {
    PUBLIC_URL,
    BACKEND_URL,
    OIDC_ISSUER: ISSUER,
    OIDC_CLIENT_ID: 'interface',
    OIDC_CLIENT_SECRET: 'test-secret',
    SESSION_SECRET_FILE: keyFile,
    ...overrides,
  };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  resetAuthConfigForTests();
  resetOidcForTests();
  resetCookies();
}

export function teardownAuthEnv(): void {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetAuthConfigForTests();
  resetOidcForTests();
  resetCookies();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
}

// ---- fake Keycloak + Backend ---------------------------------------------

export interface FetchCall {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

export class FakeServers {
  calls: FetchCall[] = [];
  nonce = '';
  roles: string[] = ['citizen'];
  name = 'Awa Diallo';
  accessLifetime = 900;
  refreshFails = false;
  /** When true the refresh grant also returns a (new) id_token. */
  refreshReturnsIdToken = false;
  guestFails = false;
  attachStatus = 200;
  tokenCounter = 0;
  /** Padding appended to tokens to exercise cookie chunking. */
  padding = 0;
  private privateKey!: CryptoKey;
  private publicJwk!: JWK;

  async init(): Promise<this> {
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    this.privateKey = privateKey;
    this.publicJwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
    vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) => this.handle(input, init));
    return this;
  }

  callsTo(fragment: string): FetchCall[] {
    return this.calls.filter((call) => call.url.includes(fragment));
  }

  private async jwt(claims: Record<string, unknown>, lifetime: number): Promise<string> {
    return new SignJWT({ ...claims, pad: 'x'.repeat(this.padding) })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + lifetime)
      .sign(this.privateKey);
  }

  private async tokenResponse(withIdToken: boolean): Promise<Response> {
    this.tokenCounter += 1;
    const n = this.tokenCounter;
    const body: Record<string, unknown> = {
      access_token: await this.jwt({ sub: 'user-1', jti: `a${n}`, realm_access: { roles: this.roles }, aud: 'techma-backend' }, this.accessLifetime),
      refresh_token: `refresh-${n}`,
      token_type: 'Bearer',
      expires_in: this.accessLifetime,
      refresh_expires_in: 1800,
    };
    if (withIdToken) {
      body.id_token = await new SignJWT({ nonce: this.nonce, name: this.name })
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setIssuer(ISSUER)
        .setSubject('user-1')
        .setAudience('interface')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(this.privateKey);
    }
    return Response.json(body);
  }

  private async handle(input: unknown, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : String(input);
    const headers = new Headers(request ? request.headers : init?.headers);
    const rawBody = init?.body ?? (request ? await request.text() : '');
    const body = rawBody == null ? '' : String(rawBody);
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    this.calls.push({ url, method, headers, body });

    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
        token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
        end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
        jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['ES256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      });
    }
    if (url === `${ISSUER}/protocol/openid-connect/certs`) return Response.json({ keys: [this.publicJwk] });
    if (url === `${ISSUER}/protocol/openid-connect/token`) {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') === 'refresh_token') {
        if (this.refreshFails) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        return this.tokenResponse(this.refreshReturnsIdToken);
      }
      return this.tokenResponse(true);
    }
    if (url === `${BACKEND_URL}/v1/guest-sessions`) {
      if (this.guestFails) return new Response('{}', { status: 503 });
      return Response.json(
        { token: `guest-token-${this.calls.length}`, expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString() },
        { status: 201 },
      );
    }
    if (url.startsWith(`${BACKEND_URL}/v1/conversations/`) && url.endsWith('/attach')) {
      return this.attachStatus === 200 ? Response.json({ conversationIds: [] }) : new Response('{}', { status: this.attachStatus });
    }
    return new Response('unexpected', { status: 599 });
  }
}

export const readCookie = (name: string) => jar.get(name);
