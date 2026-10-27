import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Database } from '../src/database/database.js';

const repoRoot = new URL('../../../../', import.meta.url);
const pages: Record<string, URL> = {
  '/': new URL('../../dev/console.html', import.meta.url),
  '/vitrine': new URL('../../dev/showcase.html', import.meta.url),
};
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const USER = `usr_${'0'.repeat(25)}1`;
const OTHER_USER = `usr_${'0'.repeat(25)}2`;
const PROCEDURE = 'demo-procedure';

type Actor = 'backend' | 'agent' | 'control' | 'intruder';

interface Exchange {
  actor: Actor;
  target: string;
  operation: string;
  headers: Record<string, string>;
  body: unknown;
  status: string;
  response: unknown;
  ms: number;
}

interface Session {
  conversationId?: string;
  otherConversationId?: string;
  fileId?: string;
  mandateId?: string;
  requestId?: string;
  createKey?: string;
  createdId?: string;
}

interface StepResult {
  ok: boolean;
  summary: string;
  exchanges: Exchange[];
}

interface Step {
  id: string;
  title: string;
  actor: Actor;
  expect: 'success' | 'refusal';
  story: string;
  run(session: Session): Promise<StepResult>;
}

const newId = (prefix: string) => `${prefix}_${Array.from(randomBytes(26), (byte) => CROCKFORD[byte % 32]).join('')}`;
const traceparent = () => `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;

async function httpCall(actor: Actor, base: string, path: string, init: { method?: string; token: string; body?: unknown; binary?: Uint8Array; extra?: Record<string, string> }): Promise<Exchange & { value: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${init.token}`,
    traceparent: traceparent(),
    ...(init.method === 'POST' ? { 'Idempotency-Key': randomUUID() } : {}),
    ...(init.binary ? { 'Content-Type': 'application/octet-stream' } : init.body ? { 'Content-Type': 'application/json' } : {}),
    ...init.extra,
  };
  const started = Date.now();
  const res = await fetch(new URL(path, base), { method: init.method ?? 'GET', headers, body: init.binary ?? (init.body ? JSON.stringify(init.body) : undefined) });
  const value = (await res.json()) as Record<string, unknown>;
  return {
    actor,
    target: `${actor === 'backend' ? 'Backend' : 'Tooling'} ${path.split('?')[0]}`,
    operation: `${init.method ?? 'GET'} HTTP`,
    headers,
    body: init.binary ? `<${init.binary.length} octets, ${init.extra?.['X-File-Mime-Type']}>` : (init.body ?? null),
    status: res.ok ? `HTTP ${res.status}` : `HTTP ${res.status} ${String(value.code ?? '')}`,
    response: value,
    ms: Date.now() - started,
    value,
  };
}

function mcpCaller(toolingUrl: string) {
  return async (actor: Actor, name: string, args: Record<string, unknown>, context: { userRef: string; conversationId: string; mandateId?: string; key?: string }) => {
    const headers: Record<string, string> = {
      Authorization: 'Bearer mock-agent',
      traceparent: traceparent(),
      'X-Conversation-Id': context.conversationId,
      'X-User-Ref': context.userRef,
      ...(context.mandateId ? { 'X-Mandate-Id': context.mandateId } : {}),
      'Idempotency-Key': context.key ?? randomUUID(),
    };
    const client = new Client({ name: 'demo-console', version: '1.0.0' });
    const started = Date.now();
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', toolingUrl), { requestInit: { headers } }));
    try {
      const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; structuredContent?: Record<string, unknown>; content: { text: string }[] };
      const error = result.isError ? (JSON.parse(result.content[0].text) as { code: string; detail: string }) : undefined;
      const exchange: Exchange = {
        actor,
        target: 'Tooling /mcp',
        operation: `tools/call ${name}`,
        headers,
        body: args,
        status: error ? error.code : 'OK',
        response: error ?? result.structuredContent,
        ms: Date.now() - started,
      };
      return { exchange, output: result.structuredContent, code: error?.code };
    } finally {
      await client.close();
    }
  };
}

function scenario(backendUrl: string, toolingUrl: string): Step[] {
  const mcp = mcpCaller(toolingUrl);
  const agent = (session: Session, name: string, args: Record<string, unknown>, extra: { mandate?: boolean; key?: string } = {}) =>
    mcp('agent', name, args, { userRef: USER, conversationId: session.conversationId!, mandateId: extra.mandate === false ? undefined : session.mandateId, key: extra.key });
  const needs = (session: Session, field: keyof Session, step: string) => {
    if (!session[field]) throw new Error(`Jouer d'abord l'étape « ${step} »`);
  };

  return [
    {
      id: 'conversation',
      title: "L'usager ouvre une conversation et dépose une pièce",
      actor: 'backend',
      expect: 'success',
      story: "Côté Backend (simulé) : une conversation est créée pour l'usager, puis il dépose un PDF synthétique. Le Tooling ne verra jamais le fichier, seulement sa référence fil_….",
      async run(session) {
        const conversation = await httpCall('backend', backendUrl, '/v1/conversations', { method: 'POST', token: 'mock-user', body: { channel: 'web', locale: 'fr' } });
        const other = await httpCall('backend', backendUrl, '/v1/conversations', { method: 'POST', token: 'mock-user-2', body: { channel: 'web', locale: 'fr' } });
        const file = await httpCall('backend', backendUrl, '/v1/files', { method: 'POST', token: 'mock-user', binary: new TextEncoder().encode(`PIECE SYNTHETIQUE ${randomUUID()}`), extra: { 'X-File-Mime-Type': 'application/pdf' } });
        Object.assign(session, { conversationId: conversation.value.id, otherConversationId: other.value.id, fileId: file.value.id });
        return { ok: !!session.conversationId && !!session.fileId, summary: `Conversation ${session.conversationId}, pièce ${session.fileId}`, exchanges: [conversation, file] };
      },
    },
    {
      id: 'search',
      title: "L'agent cherche la démarche",
      actor: 'agent',
      expect: 'success',
      story: "Outil de lecture : pas besoin de mandat. Le Tooling interroge l'API privée du Backend pour trouver les fiches.",
      async run(session) {
        needs(session, 'conversationId', 'conversation');
        const { exchange, output } = await agent(session, 'procedures.search', { query: 'demo', locale: 'fr' }, { mandate: false });
        const items = (output?.items ?? []) as { id: string; title: string }[];
        return { ok: items.length > 0, summary: items.map((item) => `${item.id} : ${item.title}`).join(', ') || 'aucune fiche', exchanges: [exchange] };
      },
    },
    {
      id: 'get',
      title: "L'agent lit la fiche complète",
      actor: 'agent',
      expect: 'success',
      story: "La fiche décrit les champs du formulaire et les pièces requises. C'est elle qui guidera les contrôles des étapes suivantes.",
      async run(session) {
        needs(session, 'conversationId', 'conversation');
        const { exchange, output } = await agent(session, 'procedures.get', { procedureId: PROCEDURE }, { mandate: false });
        return { ok: !!output, summary: `Pièces requises : ${(output?.requiredDocuments as string[] | undefined)?.join(', ')}`, exchanges: [exchange] };
      },
    },
    {
      id: 'create-no-mandate',
      title: "L'agent tente d'agir sans l'accord de l'usager",
      actor: 'agent',
      expect: 'refusal',
      story: "Créer une demande est une action : elle exige un mandat. Sans accord de l'usager, le Tooling refuse, quoi que dise le modèle.",
      async run(session) {
        needs(session, 'conversationId', 'conversation');
        const { exchange, code } = await agent(session, 'request.create', { procedureId: PROCEDURE }, { mandate: false });
        return { ok: code === 'MANDATE_MISSING', summary: `Refusé : ${code}`, exchanges: [exchange] };
      },
    },
    {
      id: 'consent',
      title: "L'usager clique « J'accepte » : le mandat est créé",
      actor: 'control',
      expect: 'success',
      story: "Le clic de l'usager passe par le code de consentement du Backend, jamais par le modèle. Le Tooling enregistre un mandat limité à cette démarche, cette conversation, ces droits, pour 1 h.",
      async run(session) {
        needs(session, 'conversationId', 'conversation');
        const grant = await httpCall('control', toolingUrl, '/internal/v1/mandates', {
          method: 'POST',
          token: 'mock-backend-control',
          body: {
            challenge: {
              id: newId('chl'),
              conversationId: session.conversationId,
              userRef: USER,
              procedureId: PROCEDURE,
              scopes: ['requests:write', 'documents:write', 'requests:submit'],
              consentText: 'Autoriser la préparation de la démarche fictive pendant une heure.',
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              proofToken: 'mock-proof-demo-console',
            },
            acceptedAt: new Date().toISOString(),
            evidenceRef: 'demo-console',
          },
        });
        session.mandateId = grant.value.id as string | undefined;
        return { ok: !!session.mandateId, summary: `Mandat ${session.mandateId}, expire à ${new Date(String(grant.value.expiresAt)).toLocaleTimeString('fr-FR')}`, exchanges: [grant] };
      },
    },
    {
      id: 'create',
      title: "L'agent crée la demande",
      actor: 'agent',
      expect: 'success',
      story: "Cette fois le mandat accompagne l'appel, dans un en-tête que le modèle ne voit pas. La demande naît en brouillon.",
      async run(session) {
        needs(session, 'mandateId', 'consentement');
        session.createKey = randomUUID();
        const { exchange, output } = await agent(session, 'request.create', { procedureId: PROCEDURE }, { key: session.createKey });
        session.requestId = session.createdId = output?.id as string | undefined;
        return { ok: output?.status === 'draft', summary: `${session.requestId}, statut ${output?.status}`, exchanges: [exchange] };
      },
    },
    {
      id: 'update-npi',
      title: "L'agent essaie d'y mettre un numéro d'identité",
      actor: 'agent',
      expect: 'refusal',
      story: "Les données d'identité sensibles (NPI…) sont interdites dans les champs. Le refus est appliqué par le serveur, pas par le prompt.",
      async run(session) {
        needs(session, 'requestId', 'création');
        const { exchange, code } = await agent(session, 'request.update', { requestId: session.requestId, fields: { npi: '1234567890' } });
        return { ok: code === 'INVALID_REQUEST', summary: `Refusé : ${code}`, exchanges: [exchange] };
      },
    },
    {
      id: 'update',
      title: "L'agent remplit le formulaire",
      actor: 'agent',
      expect: 'success',
      story: 'Le champ est validé contre le formulaire de la fiche. Il manque encore la pièce : la demande reste en brouillon.',
      async run(session) {
        needs(session, 'requestId', 'création');
        const { exchange, output } = await agent(session, 'request.update', { requestId: session.requestId, fields: { displayName: 'Usager fictif' } });
        return { ok: output?.status === 'draft', summary: `Statut ${output?.status}`, exchanges: [exchange] };
      },
    },
    {
      id: 'submit-early',
      title: "L'agent veut finaliser trop tôt",
      actor: 'agent',
      expect: 'refusal',
      story: 'La pièce requise manque : impossible de finaliser.',
      async run(session) {
        needs(session, 'requestId', 'création');
        const { exchange, code } = await agent(session, 'request.submit', { requestId: session.requestId });
        return { ok: code === 'REQUEST_INCOMPLETE', summary: `Refusé : ${code}`, exchanges: [exchange] };
      },
    },
    {
      id: 'attach',
      title: "L'agent joint la pièce de l'usager",
      actor: 'agent',
      expect: 'success',
      story: "Le Tooling demande au Backend si la pièce appartient bien à cet usager et si l'antivirus l'a validée. Tout est là : la demande passe à « ready ».",
      async run(session) {
        needs(session, 'requestId', 'création');
        const { exchange, output } = await agent(session, 'documents.attach', { requestId: session.requestId, fileId: session.fileId, documentType: 'demo-document' });
        return { ok: output?.status === 'ready', summary: `Statut ${output?.status}`, exchanges: [exchange] };
      },
    },
    {
      id: 'verify',
      title: "L'agent vérifie la pièce",
      actor: 'agent',
      expect: 'success',
      story: 'Contrôle technique (analyse, péremption). Ce n’est pas une certification administrative.',
      async run(session) {
        needs(session, 'requestId', 'création');
        const { exchange, output } = await agent(session, 'documents.verify', { requestId: session.requestId, fileId: session.fileId }, { mandate: false });
        return { ok: output?.status === 'valid', summary: `Pièce ${output?.status}`, exchanges: [exchange] };
      },
    },
    {
      id: 'submit',
      title: 'La demande est prête : lien vers le portail officiel',
      actor: 'agent',
      expect: 'success',
      story: "En phase 1, on ne dépose rien à la place de l'usager : la demande attend sa validation, il termine sur le portail officiel.",
      async run(session) {
        needs(session, 'requestId', 'création');
        const { exchange, output } = await agent(session, 'request.submit', { requestId: session.requestId });
        return { ok: output?.status === 'awaiting_user_validation', summary: `Statut ${output?.status}, lien ${output?.officialLink}`, exchanges: [exchange] };
      },
    },
    {
      id: 'replay',
      title: 'Le réseau coupe, le Backend renvoie le même appel',
      actor: 'agent',
      expect: 'success',
      story: "Même clé d'idempotence que la création : le Tooling renvoie la réponse d'origine au lieu de créer un doublon.",
      async run(session) {
        needs(session, 'createKey', 'création');
        const { exchange, output } = await agent(session, 'request.create', { procedureId: PROCEDURE }, { key: session.createKey });
        return { ok: output?.id === session.createdId, summary: output?.id === session.createdId ? `Même demande ${output?.id} : aucun doublon` : `Nouvelle demande ${output?.id}`, exchanges: [exchange] };
      },
    },
    {
      id: 'revoke',
      title: "L'usager envoie STOP : mandat révoqué",
      actor: 'control',
      expect: 'success',
      story: 'La révocation est immédiate et journalisée.',
      async run(session) {
        needs(session, 'mandateId', 'consentement');
        const revoked = await httpCall('control', toolingUrl, `/internal/v1/mandates/${session.mandateId}/revoke`, { method: 'POST', token: 'mock-backend-control' });
        return { ok: revoked.value.status === 'revoked', summary: `Mandat ${revoked.value.status}`, exchanges: [revoked] };
      },
    },
    {
      id: 'after-revoke',
      title: "L'agent tente une nouvelle action",
      actor: 'agent',
      expect: 'refusal',
      story: 'Après STOP, plus aucune action ne passe avec ce mandat.',
      async run(session) {
        needs(session, 'mandateId', 'consentement');
        const { exchange, code } = await agent(session, 'request.create', { procedureId: PROCEDURE });
        return { ok: code === 'MANDATE_REVOKED', summary: `Refusé : ${code}`, exchanges: [exchange] };
      },
    },
    {
      id: 'other-user',
      title: 'Un autre usager tente de lire cette demande',
      actor: 'intruder',
      expect: 'refusal',
      story: "La base filtre chaque ligne par usager (sécurité au niveau des lignes) : pour lui, la demande n'existe pas.",
      async run(session) {
        needs(session, 'requestId', 'création');
        const { exchange, code } = await mcp('intruder', 'request.status', { requestId: session.requestId }, { userRef: OTHER_USER, conversationId: session.otherConversationId! });
        return { ok: code === 'NOT_FOUND', summary: `Refusé : ${code}`, exchanges: [exchange] };
      },
    },
  ];
}

async function snapshot(db: Database, backendUrl: string, session: Session) {
  const audit = await db.transaction('system', (tx) => tx.query('select id, at, actor, action, outcome, code, conversation_id, request_id, mandate_id from audit_log order by id desc limit 50'));
  const outbox = await db.transaction('system', (tx) =>
    tx.query("select seq, event->'data'->>'kind' as kind, conversation_id, attempts, published_at, dead_at, last_error from outbox order by seq desc limit 50"),
  );
  const requests = await db.transaction({ userRef: USER }, (tx) => tx.query('select id, conversation_id, status, fields, documents, official_link, updated_at from requests order by updated_at desc'));
  const mandates = await db.transaction({ userRef: USER }, (tx) => tx.query('select id, status, scopes, expires_at, revoked_at from mandates order by created_at desc'));
  let events: unknown[] = [];
  if (session.conversationId) {
    const res = await fetch(new URL(`/v1/conversations/${session.conversationId}/events`, backendUrl), { headers: { Authorization: 'Bearer mock-user', traceparent: traceparent() } });
    if (res.ok) events = ((await res.json()) as { items: unknown[] }).items;
  }
  return { session, audit, outbox, requests, mandates, events };
}

async function main(): Promise<void> {
  const consolePort = Number(process.env.CONSOLE_PORT ?? 4321);
  const { startMocks } = await import(new URL('mocks/server.mjs', repoRoot).href);
  const mocks = await startMocks({ backendPort: 0, toolingPort: 0 });
  let app: INestApplication | undefined;
  try {
    app = await createApp(loadConfig({ AUTH_MODE: 'mock-tokens', BACKEND_URL: mocks.backendUrl, TOOLING_PORT: '0', EVENTS_INTERVAL_MS: '500' }));
    await app.listen(0, '127.0.0.1');
  } catch (error) {
    await mocks.close();
    throw error;
  }
  const toolingUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const db = app.get(Database);
  const steps = scenario(mocks.backendUrl, toolingUrl);
  let session: Session = {};

  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const page = pages[url.pathname];
      if (req.method === 'GET' && page) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(await readFile(page));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/scenario') {
        send(res, 200, { backendUrl: mocks.backendUrl, toolingUrl, steps: steps.map(({ run: _run, ...step }) => step) });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        send(res, 200, await snapshot(db, mocks.backendUrl, session));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/reset') {
        session = {};
        send(res, 200, { ok: true });
        return;
      }
      const match = /^\/api\/run\/([a-z-]+)$/.exec(url.pathname);
      const step = match && steps.find((candidate) => candidate.id === match[1]);
      if (req.method === 'POST' && step) {
        send(res, 200, await step.run(session));
        return;
      }
      send(res, 404, { error: 'Route inconnue' });
    } catch (error) {
      send(res, 409, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolve) => server.listen(consolePort, '127.0.0.1', resolve));

  console.log(`Console de démonstration : http://127.0.0.1:${consolePort}`);
  console.log(`Vue grand public         : http://127.0.0.1:${consolePort}/vitrine`);
  console.log(`Tooling réel : ${toolingUrl} (jetons de simulation, PGlite en mémoire)`);
  console.log(`Backend simulé : ${mocks.backendUrl}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.close();
      void app?.close().then(() => mocks.close()).then(() => process.exit(0));
    });
  }
}

main().catch((error: unknown) => {
  console.error(`Console interrompue : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
