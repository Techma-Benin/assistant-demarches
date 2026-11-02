import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { loadConfig } from '../src/config.js';
import { domainValidator, errorsText } from '../src/contracts.js';
import { createXroadServer } from '../src/server.js';

const openapi = JSON.parse(readFileSync(new URL('../../../../contracts/v2/xroad.openapi.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, { operationId: string; responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }>>;
};

export const TOOLING = 'mock-tooling-xroad';
export const BACKEND = 'mock-backend-xroad';
export const APPLICANT = `usr_${'0'.repeat(25)}1`;
export const OTHER_APPLICANT = `usr_${'0'.repeat(25)}2`;
export const SUPER_ADMIN = `off_01JC${'0'.repeat(21)}1`;
export const JUSTICE_ADMIN = `off_01JC${'0'.repeat(20)}10`;
export const JUSTICE_AGENT = `off_01JC${'0'.repeat(20)}11`;
export const ENSEIGNEMENT_AGENT = `off_01JC${'0'.repeat(20)}13`;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const requestId = () => `req_${Array.from(randomBytes(26), (byte) => CROCKFORD[byte % 32]).join('')}`;
export const fileId = () => `fil_${Array.from(randomBytes(26), (byte) => CROCKFORD[byte % 32]).join('')}`;
export const uploadId = () => `upl_${Array.from(randomBytes(26), (byte) => CROCKFORD[byte % 32]).join('')}`;
export const key = () => randomBytes(12).toString('hex');
export const traceparent = () => `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;

export async function startSim(t: TestContext, env: NodeJS.ProcessEnv = {}) {
  const config = loadConfig({ XROAD_PORT: '0', XROAD_SEED_HISTORY: 'off', ...env });
  const running = await createXroadServer(config).listen();
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
  traceparent?: string | null;
}

export interface Response<T = any> {
  status: number;
  body: T;
  raw: Buffer;
  headers: Headers;
}

export async function call<T = any>(base: string, method: string, path: string, options: Call = {}): Promise<Response<T>> {
  const headers: Record<string, string> = {};
  if (options.traceparent !== null) headers.traceparent = options.traceparent ?? traceparent();
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.applicant) headers['x-applicant-ref'] = options.applicant;
  if (options.official) headers['x-official-subject'] = options.official;
  if (options.body !== undefined) headers['content-type'] = options.contentType ?? 'application/json';
  if (options.idempotencyKey ?? (method === 'POST' || method === 'PUT')) headers['idempotency-key'] = options.idempotencyKey ?? key();
  const res = await fetch(base + path, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const raw = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('json') ? JSON.parse(raw.toString('utf8')) : raw.toString('latin1');
  return { status: res.status, body: body as T, raw, headers: res.headers };
}

/** Asserts the response matches the OpenAPI operation: its success schema, or Problem for errors. */
export function assertConforms(operationId: string, response: Response, expectedStatus: number): void {
  assert.equal(response.status, expectedStatus, `${operationId} : statut ${response.status} ${JSON.stringify(response.body)}`);
  const operation = Object.values(openapi.paths)
    .flatMap((methods) => Object.values(methods))
    .find((candidate) => candidate.operationId === operationId);
  assert.ok(operation, `opération inconnue : ${operationId}`);
  const declared = operation.responses[String(response.status)];
  if (!declared) {
    assert.match(response.headers.get('content-type') ?? '', /^application\/problem\+json/);
    const validate = domainValidator('Problem');
    assert.ok(validate(response.body), `Problem : ${errorsText(validate)}`);
    return;
  }
  const [type, media] = Object.entries(declared.content ?? {})[0];
  assert.match(response.headers.get('content-type') ?? '', new RegExp(`^${type.replace('+', '\\+')}`));
  const ref = media.schema?.$ref;
  if (!ref) return;
  const validate = domainValidator(ref.split('/').pop() as string);
  assert.ok(validate(response.body), `${operationId} : ${errorsText(validate)}`);
}
