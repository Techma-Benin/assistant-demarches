import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsPlugin from 'ajv-formats';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from 'jose';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

// Compilé dans apps/tooling/dist/test : la racine du dépôt est quatre niveaux plus haut.
const repoRoot = new URL('../../../../', import.meta.url);
const domain = JSON.parse(readFileSync(new URL('contracts/v1/domain.schema.json', repoRoot), 'utf8'));
const addFormats = addFormatsPlugin as unknown as (ajv: Ajv2020) => Ajv2020;
const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
ajv.addSchema(domain);

/** Valide une valeur contre une définition partagée de domain.schema.json. */
export function assertSchema(name: string, value: unknown): void {
  const validate = ajv.getSchema(`${domain.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`Schéma inconnu : ${name}`);
  if (!validate(value)) throw new Error(`${name} : ${ajv.errorsText(validate.errors)}`);
}

export const TRACEPARENT = `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`;
export const CONVERSATION_ID = `cnv_${'0'.repeat(25)}1`;
export const USER_REF = `usr_${'0'.repeat(25)}1`;

/** Démarre le service sur un port libre et l'arrête à la fin du test. */
export async function startTooling(t: TestContext, env: NodeJS.ProcessEnv = {}): Promise<string> {
  const app = await createApp(loadConfig({ TOOLING_PORT: '0', ...env }));
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  return `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
}

/** Backend simulé du dépôt (mocks/server.mjs), qui sert l'API privée des fiches. */
export async function startBackendMock(t: TestContext): Promise<string> {
  const { startMocks } = await import(new URL('mocks/server.mjs', repoRoot).href);
  const mocks = await startMocks({ backendPort: 0, toolingPort: 0 });
  t.after(() => mocks.close());
  return mocks.backendUrl as string;
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
  /** Jeton RS256 pour l'audience Tooling ; claims et options surchargeables. */
  sign(claims?: JWTPayload, options?: { expiresIn?: string; key?: CryptoKey; alg?: string }): Promise<string>;
}

/** Realm de test : JWKS et point de jeton client credentials, sans Keycloak. */
export async function startFakeOidc(t: TestContext): Promise<FakeOidc> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
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
  };
  const url = await listen(t, async (req, res) => {
    if (req.url === '/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (req.url === '/token' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      state.tokenRequests += 1;
      const ok = form.get('grant_type') === 'client_credentials' && form.get('client_id') === 'tooling-resources' && form.get('client_secret') === 'test-secret' && form.get('scope') === 'resources:read';
      // Le Backend simulé n'accepte que son jeton statique : le realm de test le délivre.
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' }).end(JSON.stringify(ok ? { access_token: 'mock-tooling-resources', expires_in: 300, token_type: 'Bearer' } : { error: 'invalid_client' }));
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
  };
  return state;
}

export interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: { type: string; text: string }[];
}

/** Client MCP officiel avec le contexte transmis en en-têtes, comme le fera le Backend. */
export async function mcpClient(t: TestContext, toolingUrl: string, token: string, headers: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: 'tooling-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${toolingUrl}/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}`, traceparent: TRACEPARENT, 'X-Conversation-Id': CONVERSATION_ID, 'X-User-Ref': USER_REF, ...headers },
    },
  });
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}

export async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

export function toolError(result: ToolResult): { code: string; detail: string; traceId: string } {
  if (!result.isError) throw new Error(`Succès inattendu : ${JSON.stringify(result.structuredContent)}`);
  return JSON.parse(result.content[0].text);
}

/** Requête initialize MCP brute, pour vérifier les refus HTTP avant le protocole. */
export function rawInitialize(toolingUrl: string, headers: Record<string, string>): Promise<Response> {
  return fetch(`${toolingUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', traceparent: TRACEPARENT, ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }),
  });
}
