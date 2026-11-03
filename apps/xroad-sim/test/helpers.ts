import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { SignJWT, exportJWK, importPKCS8 } from 'jose';
import { loadConfig } from '../src/config.js';
import { domainValidator, errorsText } from '../src/contracts.js';
import { migrate, type Database, type Tx } from '../src/database.js';
import { createXroadServer } from '../src/server.js';

const openapi = JSON.parse(readFileSync(new URL('../../../../contracts/v2/xroad.openapi.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, { operationId: string; responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }>>;
};

export const CATALOGUE_FILE = fileURLToPath(new URL('../../../../content/service-public/catalogue.json', import.meta.url));

export const APPLICANT = `usr_${'0'.repeat(25)}1`;
export const OTHER_APPLICANT = `usr_${'0'.repeat(25)}2`;
const sub = (n: string) => `7f3c2a10-${n}-4000-8000-00000000${n}`;
export const JUSTICE_AGENT = sub('0002');
export const JUSTICE_ADMIN = sub('0003');
export const ENSEIGNEMENT_AGENT = sub('0004');
export const ANIP_AGENT = sub('0005');
export const SUPER_ADMIN = sub('0006');

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ulid = () => Array.from(randomBytes(26), (byte) => CROCKFORD[byte % 32]).join('');
export const requestId = () => `req_${ulid()}`;
export const key = () => randomBytes(12).toString('hex');
export const traceparent = () => `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;

const pglite = new PGlite();

/** The real schema on an in-memory PostgreSQL. */
const database: Database = {
  transaction: <T>(fn: (tx: Tx) => Promise<T>) =>
    pglite.transaction(async (raw) => fn({ query: async (sql, params) => (await raw.query(sql, params as unknown[])).rows as never })) as Promise<T>,
  close: async () => {},
};

const TABLES = ['xroad_uploads', 'xroad_documents', 'xroad_cases', 'xroad_officials', 'xroad_activity', 'xroad_sequences', 'xroad_replies'];

/** Stands in for Keycloak: publishes a key set and signs the same tokens as the realm's service clients. */
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const signingKey = await importPKCS8(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, 'RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };
const identityProvider = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
});
await new Promise<void>((resolve) => identityProvider.listen(0, '127.0.0.1', resolve));
identityProvider.unref();
const ISSUER = `http://127.0.0.1:${(identityProvider.address() as AddressInfo).port}/realms/techma`;

export function serviceToken(azp: string, scope: string, options: { audience?: string; issuer?: string; key?: Parameters<SignJWT['sign']>[0] } = {}): Promise<string> {
  return new SignJWT({ azp, scope })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? 'techma-xroad')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(options.key ?? signingKey);
}

export const TOOLING = await serviceToken('tooling', 'events:publish files:read xroad:apply');
export const BACKEND = await serviceToken('backend', 'tools:call mandates:grant xroad:apply xroad:administer');

const simConfig = () => loadConfig({ XROAD_PORT: '0', OIDC_ISSUER: ISSUER, DATABASE_URL: 'postgres://unused', CATALOGUE_FILE });

export async function startSim(t: TestContext, now?: () => number) {
  await migrate(database);
  await database.transaction(async (tx) => {
    for (const table of TABLES) await tx.query(`truncate ${table} cascade`);
  });
  const running = await createXroadServer(simConfig(), database, now).listen();
  t.after(() => running.close());
  return running;
}

/** A new process of the service on the same database. */
export async function restartSim(t: TestContext) {
  const running = await createXroadServer(simConfig(), database).listen();
  t.after(() => running.close());
  return running;
}

export interface Call {
  token?: string;
  applicant?: string;
  official?: string;
  idempotencyKey?: string;
  body?: unknown;
  contentType?: string;
  traceparent?: string;
  headers?: Record<string, string>;
}

export interface Response<T = any> {
  status: number;
  body: T;
  raw: Buffer;
  headers: Headers;
}

const IDEMPOTENT = /^\/v1\/(cases(\/[^/]+\/(payment|responses|actions))?|officials)$/;

export async function call<T = any>(base: string, method: string, path: string, options: Call = {}): Promise<Response<T>> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.traceparent) headers.traceparent = options.traceparent;
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.applicant) headers['x-applicant-ref'] = options.applicant;
  if (options.official) headers['x-official-subject'] = options.official;
  const binary = Buffer.isBuffer(options.body);
  if (options.body !== undefined) headers['content-type'] = options.contentType ?? (binary ? 'application/octet-stream' : 'application/json');
  if (options.idempotencyKey ?? (method === 'POST' && IDEMPOTENT.test(path))) headers['idempotency-key'] = options.idempotencyKey ?? key();
  const res = await fetch(base + path, {
    method,
    headers,
    body: options.body === undefined ? undefined : binary ? new Uint8Array(options.body as Buffer) : JSON.stringify(options.body),
  });
  const raw = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('json') ? JSON.parse(raw.toString('utf8')) : raw.toString('latin1');
  return { status: res.status, body: body as T, raw, headers: res.headers };
}

/** Uploads a piece, then returns the reference a case or a response carries. */
export async function upload(base: string, documentType: string, applicant = APPLICANT, token = TOOLING) {
  const uploaded = await call(base, 'POST', '/v1/uploads', {
    token,
    applicant,
    body: Buffer.from(`%PDF-1.4 piece ${documentType}`),
    headers: { 'x-file-mime-type': 'application/pdf' },
  });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  return { documentType, uploadId: uploaded.body.id as string };
}

/** Asserts the response matches the OpenAPI operation: its success schema, or Problem for errors. */
export function assertConforms(operationId: string, response: Response, expectedStatus: number): void {
  assert.equal(response.status, expectedStatus, `${operationId} : statut ${response.status} ${JSON.stringify(response.body)}`);
  const operation = Object.values(openapi.paths)
    .flatMap((methods) => Object.values(methods))
    .find((candidate) => candidate.operationId === operationId);
  assert.ok(operation, `opération inconnue : ${operationId}`);
  if (response.status >= 400) {
    assert.ok(operation.responses[String(response.status)], `${operationId} : ${response.status} non déclaré`);
    assert.match(response.headers.get('content-type') ?? '', /^application\/problem\+json/);
    const validate = domainValidator('Problem');
    assert.ok(validate(response.body), `Problem : ${errorsText(validate)}`);
    return;
  }
  const [type, media] = Object.entries(operation.responses[String(response.status)].content ?? {})[0];
  const ref = media.schema?.$ref;
  if (!ref) return assert.ok((response.headers.get('content-type') ?? '').length > 0, type);
  assert.match(response.headers.get('content-type') ?? '', new RegExp(`^${type.replace('+', '\\+')}`));
  const validate = domainValidator(ref.split('/').pop() as string);
  assert.ok(validate(response.body), `${operationId} : ${errorsText(validate)}`);
}
