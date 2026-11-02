import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsPlugin from 'ajv-formats';
import pg from 'pg';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from 'jose';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Database } from '../src/database/database.js';

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

export const TRACEPARENT = `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`;
export const CONVERSATION_ID = `cnv_${'0'.repeat(25)}1`;
export const USER_REF = `usr_${'0'.repeat(25)}1`;

export async function startTooling(t: TestContext, env: NodeJS.ProcessEnv = {}): Promise<string> {
  return (await startToolingApp(t, env)).url;
}

async function testDatabase(t: TestContext): Promise<string | undefined> {
  const admin = process.env.TEST_DATABASE_URL;
  if (!admin) return undefined;
  const name = `tooling_test_${randomBytes(6).toString('hex')}`;
  const run = async (sql: string) => {
    const client = new pg.Client(admin);
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  };
  await run(`create database ${name}`);
  t.after(() => run(`drop database if exists ${name} with (force)`));
  const url = new URL(admin);
  url.pathname = `/${name}`;
  return url.href;
}

export async function startToolingApp(t: TestContext, env: NodeJS.ProcessEnv = {}): Promise<{ url: string; app: INestApplication; db: Database }> {
  const database = env.DATABASE_URL ?? (await testDatabase(t));
  const app = await createApp(loadConfig({ TOOLING_PORT: '0', EVENTS_PUBLISHER: 'off', ...(database ? { DATABASE_URL: database } : {}), ...env }));
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  return { url: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`, app, db: app.get(Database) };
}

export async function startBackendMock(t: TestContext): Promise<string> {
  const procedure = JSON.parse(readFileSync(new URL('contracts/v2/examples.json', repoRoot), 'utf8')).schemas.Procedure;
  const files = new Map<string, { file: { id: string; mimeType: string; sizeBytes: number; expiresAt: string }; bytes: Buffer; userRef: string }>();
  const events: unknown[] = [];
  return listen(t, async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (status: number, body: unknown, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type }).end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    if (req.method === 'POST' && url.pathname === '/v1/conversations') {
      send(201, { id: fakeId('cnv'), locale: 'fr', channel: 'web' });
      return;
    }
    if (req.method === 'GET' && /^\/v1\/conversations\/[^/]+\/events$/.test(url.pathname)) {
      send(200, { items: events, nextCursor: null });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/files') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const bytes = Buffer.concat(chunks);
      const id = fakeId('fil');
      const file = { id, mimeType: 'application/pdf', sizeBytes: Math.max(bytes.length, 1), expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
      files.set(id, { file, bytes, userRef: USER_REF });
      send(201, file);
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/internal/v1/files/') && url.pathname.endsWith('/content')) {
      const id = url.pathname.split('/')[4];
      const found = files.get(id);
      if (!found) { send(404, { code: 'NOT_FOUND' }); return; }
      send(200, found.bytes, found.file.mimeType);
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/internal/v1/files/')) {
      const id = url.pathname.split('/')[4];
      const found = files.get(id);
      if (!found) { send(404, { code: 'NOT_FOUND' }); return; }
      send(200, { file: found.file, userRef: req.headers['x-user-ref'] ?? found.userRef });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/internal/v1/procedures') {
      send(200, { items: [procedure], nextCursor: null });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/internal/v1/procedures/')) {
      const id = url.pathname.split('/').pop();
      if (id !== procedure.id) { send(404, { code: 'NOT_FOUND' }); return; }
      send(200, procedure);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/internal/v1/events') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      try {
        events.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch { /* keep the mock available even if a publisher sends a malformed envelope */ }
      send(202, { accepted: true });
      return;
    }
    send(404, { code: 'NOT_FOUND' });
  });
}

export interface XroadSim {
  url: string;
  store: any;
  close(): Promise<void>;
  restart(): Promise<void>;
}

export async function startXroadSim(t: TestContext, env: NodeJS.ProcessEnv = {}): Promise<XroadSim> {
  const { createXroadServer } = await import(new URL('apps/xroad-sim/dist/src/server.js', repoRoot).href);
  const { loadConfig: loadSimConfig } = await import(new URL('apps/xroad-sim/dist/src/config.js', repoRoot).href);
  const start = (port: string) => createXroadServer(loadSimConfig({ XROAD_PORT: port, XROAD_SEED_HISTORY: 'off', ...env })).listen();
  let running = await start('0');
  let closed = false;
  const sim: XroadSim = {
    url: running.url,
    get store() {
      return running.store;
    },
    close: async () => {
      if (!closed) await running.close();
      closed = true;
    },
    restart: async () => {
      await sim.close();
      running = await start(new URL(sim.url).port);
      closed = false;
    },
  };
  t.after(() => sim.close());
  return sim;
}

async function listen(t: TestContext, handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export interface FakeOidc {
  env: NodeJS.ProcessEnv;
  tokenRequests: number;
  signProof(challenge: { id: string; userRef: string; conversationId: string; procedureId: string; scopes: string[]; expiresAt: string }, overrides?: JWTPayload): Promise<string>;
  sign(claims?: JWTPayload, options?: { expiresIn?: string; key?: CryptoKey; alg?: string }): Promise<string>;
}

export async function startFakeOidc(t: TestContext): Promise<FakeOidc> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const proofKeys = await generateKeyPair('RS256');
  const proofJwk = { ...(await exportJWK(proofKeys.publicKey)), kid: 'proof-key', alg: 'RS256', use: 'sig' };
  const issuer = 'http://127.0.0.1/realms/test';
  const state: FakeOidc = {
    env: {},
    tokenRequests: 0,
    async sign(claims = {}, options = {}) {
      return new SignJWT({ azp: 'backend-agent', scope: 'tools:call', ...claims })
        .setProtectedHeader({ alg: options.alg ?? 'RS256', kid: 'test-key' })
        .setIssuer(claims.iss ?? issuer)
        .setAudience(claims.aud ?? 'techma-tooling')
        .setIssuedAt()
        .setExpirationTime(options.expiresIn ?? '5m')
        .sign(options.key ?? privateKey);
    },
    async signProof(challenge, overrides = {}) {
      return new SignJWT({ conversationId: challenge.conversationId, procedureId: challenge.procedureId, scopes: challenge.scopes, ...overrides })
        .setProtectedHeader({ alg: 'RS256', kid: 'proof-key' })
        .setJti(challenge.id)
        .setSubject(challenge.userRef)
        .setAudience('techma-mandate')
        .setExpirationTime(Math.floor(Date.parse(challenge.expiresAt) / 1000))
        .sign(proofKeys.privateKey);
    },
  };
  const url = await listen(t, async (req, res) => {
    if (req.url === '/proof-jwks') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [proofJwk] }));
      return;
    }
    if (req.url === '/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (req.url === '/token' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      state.tokenRequests += 1;
      const client = form.get('client_id');
      const scopes: Record<string, string> = { 'tooling-resources': 'resources:read', 'tooling-events': 'events:publish' };
      const ok = form.get('grant_type') === 'client_credentials' && !!client && form.get('client_secret') === 'test-secret' && scopes[client] === form.get('scope');
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' }).end(JSON.stringify(ok ? { access_token: `mock-${client}`, expires_in: 300, token_type: 'Bearer' } : { error: 'invalid_client' }));
      return;
    }
    res.writeHead(404).end();
  });
  state.env = {
    AUTH_MODE: 'jwt',
    JWT_ISSUER: issuer,
    JWKS_URL: `${url}/jwks`,
    OIDC_TOKEN_URL: `${url}/token`,
    TOOLING_RESOURCES_CLIENT_ID: 'tooling-resources',
    TOOLING_RESOURCES_CLIENT_SECRET: 'test-secret',
    TOOLING_EVENTS_CLIENT_ID: 'tooling-events',
    TOOLING_EVENTS_CLIENT_SECRET: 'test-secret',
    PROOF_JWKS_URL: `${url}/proof-jwks`,
  };
  return state;
}

export interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: { type: string; text: string }[];
}

export async function mcpClient(t: TestContext | undefined, toolingUrl: string, token: string, headers: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: 'tooling-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${toolingUrl}/mcp`), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
        traceparent: TRACEPARENT,
        'X-Conversation-Id': CONVERSATION_ID,
        'X-User-Ref': USER_REF,
        'X-Authenticated': 'true',
        'X-Channel': 'web',
        ...headers,
      },
    },
  });
  await client.connect(transport);
  t?.after(() => client.close());
  return client;
}

export interface ActOptions {
  mandateId?: string;
  key?: string;
  conversationId?: string;
  userRef?: string;
  token?: string;
  authenticated?: boolean;
  channel?: 'web' | 'whatsapp';
}

export function toFields(values: Record<string, unknown>) {
  return Object.entries(values).map(([name, value]) => ({ name, value, source: 'answer' as const }));
}

export async function act(toolingUrl: string, name: string, args: Record<string, unknown>, options: ActOptions = {}): Promise<ToolResult> {
  const client = await mcpClient(undefined, toolingUrl, options.token ?? 'mock-agent', {
    'Idempotency-Key': options.key ?? randomUUID(),
    'X-Authenticated': options.authenticated === false ? 'false' : 'true',
    'X-Channel': options.channel ?? 'web',
    ...(options.mandateId ? { 'X-Mandate-Id': options.mandateId } : {}),
    ...(options.conversationId ? { 'X-Conversation-Id': options.conversationId } : {}),
    ...(options.userRef ? { 'X-User-Ref': options.userRef } : {}),
  });
  try {
    return await callTool(client, name, args);
  } finally {
    await client.close();
  }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const fakeId = (prefix: string) => `${prefix}_${Array.from(randomBytes(26), (b) => CROCKFORD[b % 32]).join('')}`;

export interface ChallengeInput {
  id: string;
  conversationId: string;
  userRef: string;
  procedureId: string;
  scopes: string[];
  consentText: string;
  expiresAt: string;
  proofToken: string;
}

export function challenge(overrides: Partial<ChallengeInput> = {}): ChallengeInput {
  return {
    id: fakeId('chl'),
    conversationId: CONVERSATION_ID,
    userRef: USER_REF,
    procedureId: 'PS00373',
    scopes: ['requests:write', 'documents:write', 'requests:submit'],
    consentText: 'Autoriser cette démarche fictive pour une heure.',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    proofToken: 'mock-proof-test',
    ...overrides,
  };
}

export async function postInternal(toolingUrl: string, path: string, body: unknown, options: { key?: string; token?: string } = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${toolingUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token ?? 'mock-backend-control'}`,
      traceparent: TRACEPARENT,
      'Idempotency-Key': options.key ?? randomUUID(),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

export async function grantMandate(toolingUrl: string, overrides: Partial<ChallengeInput> = {}, options: { key?: string; token?: string } = {}) {
  return postInternal(toolingUrl, '/internal/v1/mandates', { challenge: challenge(overrides), acceptedAt: new Date().toISOString(), evidenceRef: 'proof_test' }, options);
}

export async function uploadFile(backendUrl: string, token = 'mock-user'): Promise<string> {
  const res = await fetch(`${backendUrl}/v1/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, traceparent: TRACEPARENT, 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/octet-stream', 'X-File-Mime-Type': 'application/pdf' },
    body: new TextEncoder().encode(`SYNTHETIC PDF ${randomUUID()}`),
  });
  const file = (await res.json()) as { id: string };
  return file.id;
}

export async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

export function toolError(result: ToolResult): { code: string; detail: string; traceId: string } {
  if (!result.isError) throw new Error(`Succès inattendu : ${JSON.stringify(result.structuredContent)}`);
  return JSON.parse(result.content[0].text);
}

export function rawInitialize(toolingUrl: string, headers: Record<string, string>): Promise<Response> {
  return fetch(`${toolingUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', traceparent: TRACEPARENT, ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }),
  });
}
