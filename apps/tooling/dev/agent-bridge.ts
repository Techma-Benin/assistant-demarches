import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ALL_SCOPES = ['requests:write', 'documents:write', 'requests:submit'];

export interface BridgeOptions {
  toolingUrl: URL;
  backendUrl?: URL;
  userRef: string;
  procedureId: string;
  scopes: string[];
  log: (message: string) => void;
}

export interface BridgeSession {
  conversationId: string;
  mandateId: string;
  fileId?: string;
}

const newId = (prefix: string) => `${prefix}_${Array.from(randomBytes(26), (byte) => CROCKFORD[byte % 32]).join('')}`;
const traceparent = () => `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;

export function localUrl(name: string, raw: string): URL {
  const url = new URL(raw);
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error(`${name} doit viser localhost : le pont n'utilise que les jetons de simulation`);
  return url;
}

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): BridgeOptions {
  return {
    toolingUrl: localUrl('TOOLING_URL', env.TOOLING_URL ?? 'http://127.0.0.1:4030'),
    backendUrl: env.BACKEND_URL === '' ? undefined : localUrl('BACKEND_URL', env.BACKEND_URL ?? 'http://127.0.0.1:4010'),
    userRef: env.BRIDGE_USER_REF ?? `usr_${'0'.repeat(25)}1`,
    procedureId: env.BRIDGE_PROCEDURE_ID ?? 'demo-procedure',
    scopes: env.BRIDGE_SCOPES ? env.BRIDGE_SCOPES.split(',').map((scope) => scope.trim()) : ALL_SCOPES,
    log: (message) => process.stderr.write(`[pont] ${message}\n`),
  };
}

async function grantMandate(options: BridgeOptions, conversationId: string): Promise<string> {
  const res = await fetch(new URL('/internal/v1/mandates', options.toolingUrl), {
    method: 'POST',
    headers: { Authorization: 'Bearer mock-backend-control', traceparent: traceparent(), 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challenge: {
        id: newId('chl'),
        conversationId,
        userRef: options.userRef,
        procedureId: options.procedureId,
        scopes: options.scopes,
        consentText: 'Consentement simulé par le pont de développement.',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        proofToken: 'mock-proof-agent-bridge',
      },
      acceptedAt: new Date().toISOString(),
      evidenceRef: 'agent-bridge',
    }),
  });
  const body = (await res.json()) as { id?: string; code?: string };
  if (res.status !== 201 || !body.id) throw new Error(`Mandat refusé par le Tooling : HTTP ${res.status} ${body.code ?? ''}`);
  return body.id;
}

async function uploadSyntheticFile(backendUrl: URL): Promise<string> {
  const res = await fetch(new URL('/v1/files', backendUrl), {
    method: 'POST',
    headers: { Authorization: 'Bearer mock-user', traceparent: traceparent(), 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/octet-stream', 'X-File-Mime-Type': 'application/pdf' },
    body: new TextEncoder().encode(`PIECE SYNTHETIQUE ${randomUUID()}`),
  });
  const body = (await res.json()) as { id?: string };
  if (res.status !== 201 || !body.id) throw new Error(`Dépôt de pièce refusé : HTTP ${res.status}`);
  return body.id;
}

export async function prepareSession(options: BridgeOptions): Promise<BridgeSession> {
  const conversationId = newId('cnv');
  const mandateId = await grantMandate(options, conversationId);
  options.log(`conversation ${conversationId}, mandat ${mandateId} (${options.scopes.join(', ')}) pour ${options.procedureId}`);
  let fileId: string | undefined;
  if (options.backendUrl) {
    try {
      fileId = await uploadSyntheticFile(options.backendUrl);
      options.log(`pièce synthétique ${fileId}`);
    } catch (error) {
      options.log(`pas de pièce synthétique : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { conversationId, mandateId, fileId };
}

export function instructionsFor(options: BridgeOptions, session: BridgeSession): string {
  return [
    "Outils du service Tooling de l'assistant démarches (environnement de développement, données fictives).",
    `L'usager a déjà donné son accord pour la démarche « ${options.procedureId} » ; le mandat est transmis automatiquement.`,
    'Les identifiants de conversation, d’usager et de mandat sont gérés par le pont : ne jamais les passer en argument.',
    session.fileId
      ? `Une pièce synthétique déjà analysée est disponible : fileId « ${session.fileId} », à joindre avec documents.attach.`
      : 'Aucune pièce synthétique disponible dans cette session.',
    "Préparer une demande : request.create, request.update (champs du formSchema de la fiche), documents.attach pour chaque requiredDocuments, puis request.submit. La démarche se termine sur le portail officiel via officialLink.",
  ].join('\n');
}

export function createBridgeServer(options: BridgeOptions, session: BridgeSession): Server {
  const mcpUrl = new URL('/mcp', options.toolingUrl);
  const upstream = async <T>(use: (client: Client) => Promise<T>): Promise<T> => {
    const client = new Client({ name: 'tooling-agent-bridge', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(mcpUrl, {
      requestInit: {
        headers: {
          Authorization: 'Bearer mock-agent',
          traceparent: traceparent(),
          'X-Conversation-Id': session.conversationId,
          'X-User-Ref': options.userRef,
          'X-Mandate-Id': session.mandateId,
          'Idempotency-Key': randomUUID(),
        },
      },
    });
    await client.connect(transport);
    try {
      return await use(client);
    } finally {
      await client.close();
    }
  };

  const server = new Server({ name: 'techma-tooling-bridge', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: instructionsFor(options, session) });
  let tools: Tool[] | undefined;
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    tools ??= (await upstream((client) => client.listTools())).tools;
    return { tools };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name } = request.params;
    try {
      const result = (await upstream((client) => client.callTool({ name, arguments: request.params.arguments ?? {} }))) as CallToolResult;
      const code = result.isError ? (JSON.parse((result.content[0] as { text: string }).text) as { code?: string }).code : 'OK';
      options.log(`${name} → ${code}`);
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      options.log(`${name} → échec de transport : ${detail}`);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'UPSTREAM_UNAVAILABLE', detail }) }] };
    }
  });
  return server;
}

async function main(): Promise<void> {
  const options = optionsFromEnv();
  const session = await prepareSession(options);
  const server = createBridgeServer(options, session);
  await server.connect(new StdioServerTransport());
  options.log(`prêt, relais vers ${options.toolingUrl.origin}/mcp`);
  process.stdin.on('close', () => process.exit(0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`[pont] démarrage impossible : ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
