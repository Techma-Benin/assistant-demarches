import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { INestApplication } from '@nestjs/common';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsPlugin from 'ajv-formats';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from 'jose';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Database } from '../src/database/database.js';
import { CaseTracker } from '../src/tracking/case-tracker.js';

const repoRoot = new URL('../../../../', import.meta.url);
const domain = JSON.parse(readFileSync(new URL('contracts/v2/domain.schema.json', repoRoot), 'utf8'));
const addFormats = addFormatsPlugin as unknown as (ajv: Ajv2020) => Ajv2020;
const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
ajv.addSchema(domain);

export function assertSchema(name: string, value: unknown): void {
  const validate = ajv.getSchema(`${domain.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`Schéma inconnu : ${name}`);
  if (!validate(value)) throw new Error(`${name} : ${ajv.errorsText(validate.errors)}`);
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const fakeId = (prefix: string) => `${prefix}_${Array.from(randomBytes(26), (b) => CROCKFORD[b % 32]).join('')}`;
export const TRACEPARENT = `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`;
export const CONVERSATION_ID = `cnv_${'0'.repeat(25)}1`;
export const USER_REF = `usr_${'0'.repeat(25)}1`;
export const OTHER_USER = `usr_${'0'.repeat(25)}2`;
const subject = (n: string) => `7f3c2a10-${n}-4000-8000-00000000${n}`;
export const JUSTICE_AGENT = subject('0002');
export const ANIP_AGENT = subject('0005');
export const SCOPES = ['requests:write', 'documents:write', 'requests:submit'];

async function listen(t: TestContext, handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' }).end(JSON.stringify(body));
};

export interface FakeKeycloak {
  issuer: string;
  tokenRequests: number;
  sign(claims: JWTPayload, options?: { audience?: string | string[]; issuer?: string; expiresIn?: string; key?: CryptoKey; alg?: string }): Promise<string>;
  backend(scope?: string, audience?: string): Promise<string>;
}

export async function startKeycloak(t: TestContext): Promise<FakeKeycloak> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'realm-key', alg: 'RS256', use: 'sig' };
  const state = {
    issuer: '',
    tokenRequests: 0,
    sign(claims: JWTPayload, options: { audience?: string | string[]; issuer?: string; expiresIn?: string; key?: CryptoKey; alg?: string } = {}) {
      return new SignJWT(claims)
        .setProtectedHeader({ alg: options.alg ?? 'RS256', kid: 'realm-key' })
        .setIssuer(options.issuer ?? state.issuer)
        .setAudience(options.audience ?? 'techma-tooling')
        .setIssuedAt()
        .setExpirationTime(options.expiresIn ?? '5m')
        .sign(options.key ?? privateKey);
    },
    backend(scope = 'tools:call mandates:grant xroad:apply xroad:administer', audience = 'techma-tooling') {
      return state.sign({ azp: 'backend', scope }, { audience });
    },
  };
  const url = await listen(t, async (req, res) => {
    if (req.url === '/realms/techma/protocol/openid-connect/certs') return json(res, 200, { keys: [jwk] });
    if (req.url === '/realms/techma/protocol/openid-connect/token' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      state.tokenRequests += 1;
      const ok = form.get('grant_type') === 'client_credentials' && form.get('client_id') === 'tooling' && form.get('client_secret') === 'test-secret';
      if (!ok) return json(res, 401, { error: 'invalid_client' });
      const token = await state.sign({ azp: 'tooling', scope: 'events:publish files:read xroad:apply' }, { audience: ['techma-backend', 'techma-xroad'] });
      return json(res, 200, { access_token: token, expires_in: 300, token_type: 'Bearer' });
    }
    json(res, 404, { error: 'not_found' });
  });
  state.issuer = `${url}/realms/techma`;
  return state;
}

export interface StoredFile {
  id: string;
  userRef: string;
  mimeType: string;
  bytes: Buffer;
  expiresAt: string;
}

export interface FakeBackend {
  url: string;
  events: Array<{ id: string; type: string; data: any }>;
  files: Map<string, StoredFile>;
  failEvents: number;
  addFile(userRef?: string, mimeType?: string, expiresInMs?: number): string;
  signProof(challenge: { id: string; userRef: string; conversationId: string; procedureId: string; scopes: string[]; expiresAt: string }, overrides?: JWTPayload): Promise<string>;
}

export async function startBackend(t: TestContext): Promise<FakeBackend> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'backend-proof', alg: 'RS256', use: 'sig' };
  const state: FakeBackend = {
    url: '',
    events: [],
    files: new Map(),
    failEvents: 0,
    addFile(userRef = USER_REF, mimeType = 'application/pdf', expiresInMs = 3_600_000) {
      const id = fakeId('fil');
      state.files.set(id, { id, userRef, mimeType, bytes: Buffer.from(`%PDF-1.4 pièce de test ${id}`), expiresAt: new Date(Date.now() + expiresInMs).toISOString() });
      return id;
    },
    signProof(challenge, overrides = {}) {
      return new SignJWT({ conversationId: challenge.conversationId, procedureId: challenge.procedureId, scopes: challenge.scopes, ...overrides })
        .setProtectedHeader({ alg: 'RS256', kid: 'backend-proof' })
        .setJti(challenge.id)
        .setSubject(challenge.userRef)
        .setAudience('techma-mandate')
        .setExpirationTime(Math.floor(Date.parse(challenge.expiresAt) / 1000))
        .sign(privateKey);
    },
  };
  state.url = await listen(t, async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/.well-known/jwks.json') return json(res, 200, { keys: [jwk] });
    if (!/^Bearer \S+$/.test(req.headers.authorization ?? '')) return json(res, 401, { code: 'UNAUTHORIZED' });
    const file = /^\/internal\/v1\/files\/([^/]+)(\/content)?$/.exec(url.pathname);
    if (file && req.method === 'GET') {
      const found = state.files.get(file[1]);
      if (!found || found.userRef !== req.headers['x-user-ref']) return json(res, 404, { code: 'NOT_FOUND' });
      if (file[2]) {
        res.writeHead(200, { 'content-type': found.mimeType, 'content-length': String(found.bytes.length) }).end(found.bytes);
        return;
      }
      return json(res, 200, { file: { id: found.id, mimeType: found.mimeType, sizeBytes: found.bytes.length, expiresAt: found.expiresAt }, userRef: found.userRef });
    }
    if (url.pathname === '/internal/v1/events' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      if (state.failEvents > 0) {
        state.failEvents -= 1;
        return json(res, 503, { code: 'UPSTREAM_UNAVAILABLE' });
      }
      const event = JSON.parse(body);
      assertSchema('Event', event);
      if (!state.events.some((seen) => seen.id === event.id)) state.events.push(event);
      return json(res, 202, event);
    }
    json(res, 404, { code: 'NOT_FOUND' });
  });
  return state;
}

export interface XroadSim {
  url: string;
  official(subjectId: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
}

export async function startXroad(t: TestContext, keycloak: FakeKeycloak): Promise<XroadSim> {
  const { createXroadServer } = await import(new URL('apps/xroad-sim/dist/src/server.js', repoRoot).href);
  const { loadConfig: loadSimConfig } = await import(new URL('apps/xroad-sim/dist/src/config.js', repoRoot).href);
  const { migrate } = await import(new URL('apps/xroad-sim/dist/src/database.js', repoRoot).href);
  const pglite = await PGlite.create();
  const database = {
    transaction: <T>(fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }) => Promise<T>) =>
      pglite.transaction(async (raw) => fn({ query: async (sql, params) => (await raw.query(sql, params)).rows })),
    close: async () => {},
  };
  await migrate(database);
  const catalogue = fileURLToPath(new URL('content/service-public/catalogue.json', repoRoot));
  const running = await createXroadServer(loadSimConfig({ XROAD_PORT: '0', OIDC_ISSUER: keycloak.issuer, DATABASE_URL: 'postgres://unused', CATALOGUE_FILE: catalogue }), database).listen();
  t.after(async () => {
    await running.close();
    await pglite.close();
  });
  return {
    url: running.url,
    async official(subjectId, method, path, body) {
      const token = await keycloak.backend('xroad:administer', 'techma-xroad');
      const res = await fetch(`${running.url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          traceparent: TRACEPARENT,
          'X-Official-Subject': subjectId,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    },
  };
}

export interface Stack {
  url: string;
  app: INestApplication;
  db: Database;
  tracker: CaseTracker;
  keycloak: FakeKeycloak;
  backend: FakeBackend;
  xroad: XroadSim;
}

export async function startStack(t: TestContext, env: NodeJS.ProcessEnv = {}): Promise<Stack> {
  const keycloak = await startKeycloak(t);
  const backend = await startBackend(t);
  const xroad = await startXroad(t, keycloak);
  const app = await createApp(
    loadConfig({
      NODE_ENV: 'test',
      TOOLING_PORT: '0',
      DATABASE_URL: 'pglite:memory',
      OIDC_ISSUER: keycloak.issuer,
      OIDC_CLIENT_SECRET: 'test-secret',
      BACKEND_URL: backend.url,
      XROAD_URL: xroad.url,
      EVENTS_PUBLISHER: 'off',
      TRACKING_WORKER: 'off',
      TRACKING_POLL_MS: '20',
      ...env,
    }),
    { shutdownHooks: false },
  );
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  return { url, app, db: app.get(Database), tracker: app.get(CaseTracker), keycloak, backend, xroad };
}

export interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, any>;
}

export interface CallOptions {
  mandateId?: string;
  key?: string;
  channel?: string;
  conversationId?: string;
  userRef?: string;
  token?: string;
}

export async function mcpClient(s: Stack, headers: Record<string, string>, token?: string): Promise<Client> {
  const client = new Client({ name: 'tooling-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token ?? (await s.keycloak.backend('tools:call'))}`, traceparent: TRACEPARENT, ...headers } },
    }),
  );
  return client;
}

export async function act(s: Stack, name: string, args: Record<string, unknown>, options: CallOptions = {}): Promise<ToolResult> {
  const client = await mcpClient(
    s,
    {
      'X-Conversation-Id': options.conversationId ?? CONVERSATION_ID,
      'X-User-Ref': options.userRef ?? USER_REF,
      'Idempotency-Key': options.key ?? randomUUID(),
      ...(options.mandateId ? { 'X-Mandate-Id': options.mandateId } : {}),
      ...(options.channel ? { 'X-Channel': options.channel } : {}),
    },
    options.token,
  );
  try {
    return (await client.callTool({ name, arguments: args })) as ToolResult;
  } finally {
    await client.close();
  }
}

export function toolError(result: ToolResult): { code: string; detail: string; traceId: string } {
  if (!result.isError) throw new Error(`Succès inattendu : ${result.content[0]?.text}`);
  return JSON.parse(result.content[0].text);
}

export function ok(result: ToolResult): Record<string, any> {
  if (result.isError) throw new Error(`Échec inattendu : ${result.content[0]?.text}`);
  return result.structuredContent!;
}

export async function postInternal(s: Stack, path: string, body: unknown, options: { key?: string; token?: string; userRef?: string } = {}) {
  const res = await fetch(`${s.url}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token ?? (await s.keycloak.backend('mandates:grant'))}`,
      traceparent: TRACEPARENT,
      'Idempotency-Key': options.key ?? randomUUID(),
      ...(options.userRef ? { 'X-User-Ref': options.userRef } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

export function challenge(procedureId: string, overrides: Partial<{ userRef: string; conversationId: string; scopes: string[] }> = {}) {
  return {
    id: fakeId('chl'),
    conversationId: overrides.conversationId ?? CONVERSATION_ID,
    userRef: overrides.userRef ?? USER_REF,
    procedureId,
    scopes: overrides.scopes ?? SCOPES,
    consentText: 'Autoriser l’assistant à préparer et déposer cette démarche pendant une heure.',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  };
}

export async function grantMandate(s: Stack, procedureId: string, overrides: Parameters<typeof challenge>[1] = {}): Promise<string> {
  const base = challenge(procedureId, overrides);
  const proofToken = await s.backend.signProof(base);
  const res = await postInternal(s, '/internal/v1/mandates', { challenge: { ...base, proofToken }, acceptedAt: new Date().toISOString(), evidenceRef: 'consent_test' });
  if (res.status !== 201) throw new Error(`Mandat refusé : ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

export async function rows<R = Record<string, any>>(s: Stack, sql: string, params: unknown[] = []): Promise<R[]> {
  return s.db.transaction('system', (tx) => tx.query<R>(sql, params));
}
