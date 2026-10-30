import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ServiceAuth, requireScope, type Principal } from './auth.js';
import type { SimConfig } from './config.js';
import { domainValidator, errorsText } from './contracts.js';
import { canonicalJson, sha256 } from './ids.js';
import { simulatedPdf } from './pdf.js';
import { ProblemError, invalid, type ProblemCode } from './problem.js';
import { XroadStore, type Caller, type CaseView, type Decider } from './store.js';
import { overviewPage, type Exchange } from './overview.js';

const TRACEPARENT = /^00-([a-f0-9]{32})-([a-f0-9]{16})-0[01]$/;
const MAX_BODY = 64 * 1024;
const VIEWS = new Set<CaseView>(['pending', 'completed', 'all']);
const ACTOR_REF = /^[\x21-\x7e]{1,255}$/;

interface Context {
  req: http.IncomingMessage;
  url: URL;
  traceId: string;
  principal: Principal;
  params: string[];
}

interface Reply {
  status: number;
  body: unknown;
  type?: string;
}

type Handler = (context: Context) => Promise<Reply> | Reply;

const validators = {
  userRef: domainValidator('UserRef'),
  officialId: domainValidator('OfficialId'),
  administrationId: domainValidator('AdministrationId'),
  caseId: domainValidator('CaseId'),
  documentId: domainValidator('IssuedDocumentId'),
  caseInput: domainValidator('CaseInput'),
  paymentInput: domainValidator('PaymentInput'),
  decision: domainValidator('CaseDecision'),
  assignment: domainValidator('OfficialAssignment'),
};

export interface XroadServer {
  url: string;
  store: XroadStore;
  close(): Promise<void>;
}

export function createXroadServer(config: SimConfig, store = new XroadStore({ seedHistory: config.seedHistory, stateFile: config.stateFile })) {
  const auth = new ServiceAuth(config);
  const exchanges: Exchange[] = [];

  const page = <T>(items: T[], url: URL) => {
    const limit = integerParam(url, 'limit', 20, 1, 100);
    const raw = url.searchParams.get('cursor');
    const offset = raw === null ? 0 : Number(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Number.isInteger(offset) || offset < 0) throw invalid('Curseur invalide');
    const next = offset + limit < items.length ? Buffer.from(String(offset + limit)).toString('base64url') : null;
    return { items: items.slice(offset, offset + limit), nextCursor: next };
  };

  const applicant = (context: Context): string => {
    requireScope(context.principal, 'xroad:submit', ['tooling-xroad']);
    const value = context.req.headers['x-applicant-ref'];
    if (typeof value !== 'string' || !validators.userRef(value)) throw invalid('X-Applicant-Ref requis');
    return value;
  };

  const official = (context: Context, optional = false) => {
    requireScope(context.principal, 'xroad:administer', ['backend-xroad']);
    const value = context.req.headers['x-official-id'];
    if (value === undefined && optional) return undefined;
    if (typeof value !== 'string' || !validators.officialId(value)) throw invalid('X-Official-Id requis');
    return store.official(value);
  };

  /** GET on a case accepts exactly one identity: the applicant (Tooling) or an official (Backend). */
  const caller = (context: Context): Caller => {
    const hasApplicant = context.req.headers['x-applicant-ref'] !== undefined;
    const hasOfficial = context.req.headers['x-official-id'] !== undefined;
    if (hasApplicant === hasOfficial) throw invalid('Exactement un en-tête requis : X-Applicant-Ref ou X-Official-Id');
    if (hasApplicant) return { kind: 'applicant', applicantRef: applicant(context) };
    return { kind: 'official', official: official(context) as NonNullable<ReturnType<typeof official>> };
  };

  const decider = (context: Context): Decider => {
    const hasOfficial = context.req.headers['x-official-id'] !== undefined;
    const hasActor = context.req.headers['x-actor-ref'] !== undefined;
    if (hasOfficial === hasActor) throw invalid('Exactement un en-tête requis : X-Official-Id ou X-Actor-Ref');
    if (hasOfficial) return { kind: 'official', official: official(context)! };
    requireScope(context.principal, 'xroad:decide', ['tooling-xroad']);
    const value = context.req.headers['x-actor-ref'];
    if (typeof value !== 'string' || !ACTOR_REF.test(value)) throw invalid('X-Actor-Ref invalide');
    return { kind: 'console', actorRef: value };
  };

  const filter = (url: URL): string | undefined => {
    const value = url.searchParams.get('administrationId') ?? undefined;
    if (value !== undefined && !validators.administrationId(value)) throw invalid('administrationId invalide');
    return value;
  };

  const pathId = (value: string, validate: (typeof validators)[keyof typeof validators], label: string) => {
    if (!validate(value)) throw new ProblemError(404, 'NOT_FOUND', `${label} inconnu`);
    return value;
  };

  const reader = (context: Context) => requireScope(context.principal, 'xroad:read', ['tooling-xroad', 'backend-xroad']);

  const routes: { method: string; pattern: RegExp; name: string; handler: Handler; body?: keyof typeof validators }[] = [
    {
      method: 'GET',
      pattern: /^\/v1\/administrations$/,
      name: 'listXroadAdministrations',
      handler: (context) => {
        reader(context);
        return { status: 200, body: page(store.listAdministrations(), context.url) };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/procedures$/,
      name: 'searchXroadProcedures',
      handler: (context) => {
        reader(context);
        const query = context.url.searchParams.get('query') ?? undefined;
        if (query !== undefined && !query.trim()) throw invalid('query vide');
        return { status: 200, body: page(store.searchProcedures(query, filter(context.url)), context.url) };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/procedures\/([^/]+)$/,
      name: 'getXroadProcedure',
      handler: (context) => {
        reader(context);
        return { status: 200, body: store.getProcedure(decodeURIComponent(context.params[0])) };
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/cases$/,
      name: 'createXroadCase',
      body: 'caseInput',
      handler: async (context) => {
        const applicantRef = applicant(context);
        return { status: 201, body: store.createCase(applicantRef, (await readJson(context.req)) as never) };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/cases$/,
      name: 'listXroadCases',
      handler: (context) => {
        const viewer = official(context)!;
        const view = (context.url.searchParams.get('view') ?? 'all') as CaseView;
        if (!VIEWS.has(view)) throw invalid('view doit valoir pending, completed ou all');
        return { status: 200, body: page(store.listCases(viewer, filter(context.url), view), context.url) };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/cases\/([^/]+)$/,
      name: 'getXroadCase',
      handler: (context) => ({ status: 200, body: store.getCase(caller(context), pathId(context.params[0], validators.caseId, 'Dossier')) }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/cases\/([^/]+)\/payment$/,
      name: 'payXroadCase',
      body: 'paymentInput',
      handler: async (context) => {
        const applicantRef = applicant(context);
        await readJson(context.req);
        return { status: 200, body: store.pay(applicantRef, pathId(context.params[0], validators.caseId, 'Dossier')) };
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/cases\/([^/]+)\/decisions$/,
      name: 'decideXroadCase',
      body: 'decision',
      handler: async (context) => {
        const by = decider(context);
        const input = (await readJson(context.req)) as { decision: 'approve' | 'reject'; note: string | null };
        return { status: 200, body: store.decide(by, pathId(context.params[0], validators.caseId, 'Dossier'), input.decision, input.note) };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/cases\/([^/]+)\/documents\/([^/]+)$/,
      name: 'downloadXroadIssuedDocument',
      handler: (context) => {
        const found = store.issuedDocument(
          caller(context),
          pathId(context.params[0], validators.caseId, 'Dossier'),
          pathId(context.params[1], validators.documentId, 'Document'),
        );
        const procedure = store.getProcedure(found.record.procedureId);
        const pdf = simulatedPdf(found.title, [
          `Reference du dossier : ${found.record.reference}`,
          `Demarche : ${procedure.title}`,
          `Delivre le : ${found.issuedAt.slice(0, 10)}`,
          'Document produit par le X-Road simule du projet Assistant-demarches.',
        ]);
        return { status: 200, body: pdf, type: 'application/pdf' };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/officials\/me$/,
      name: 'getXroadCurrentOfficial',
      handler: (context) => ({ status: 200, body: official(context) }),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/officials$/,
      name: 'listXroadOfficials',
      handler: (context) => ({ status: 200, body: page(store.listOfficials(official(context, true), filter(context.url)), context.url) }),
    },
    {
      method: 'PUT',
      pattern: /^\/v1\/officials\/([^/]+)\/assignment$/,
      name: 'assignXroadOfficial',
      body: 'assignment',
      handler: async (context) => {
        const viewer = official(context)!;
        const input = (await readJson(context.req)) as { administrationId: string | null; role: 'agent' | 'admin' | 'super_admin' };
        return { status: 200, body: store.assign(viewer, pathId(context.params[0], validators.officialId, 'Agent'), input.administrationId, input.role) };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/metrics$/,
      name: 'getXroadMetrics',
      handler: (context) => ({ status: 200, body: store.metrics(official(context)!, filter(context.url)) }),
    },
  ];

  // Bodies are read once and kept, so idempotency and handlers see the same payload.
  const bodies = new WeakMap<http.IncomingMessage, Promise<unknown>>();
  const readJson = (req: http.IncomingMessage): Promise<unknown> => {
    let pending = bodies.get(req);
    if (!pending) {
      pending = readBody(req);
      bodies.set(req, pending);
    }
    return pending;
  };

  const dispatch = async (req: http.IncomingMessage, url: URL, traceId: string): Promise<{ reply: Reply; client?: string; name?: string }> => {
    const route = routes.find((candidate) => candidate.method === req.method && candidate.pattern.test(url.pathname));
    if (!route) {
      const known = routes.some((candidate) => candidate.pattern.test(url.pathname));
      throw new ProblemError(known ? 400 : 404, known ? 'INVALID_REQUEST' : 'NOT_FOUND', known ? 'Méthode non prise en charge' : 'Route inconnue');
    }
    const principal = await auth.authenticate(req.headers.authorization);
    const context: Context = { req, url, traceId, principal, params: route.pattern.exec(url.pathname)!.slice(1) };

    if (route.body) {
      const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') throw new ProblemError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Corps JSON attendu');
      const body = await readJson(req);
      const validate = validators[route.body];
      if (!validate(body)) throw invalid(`Corps invalide : ${errorsText(validate)}`);
    }

    if (req.method !== 'POST' && req.method !== 'PUT') return { reply: await route.handler(context), client: principal.client, name: route.name };

    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) throw invalid('Idempotency-Key de 8 à 128 caractères requise');
    const scope = `${principal.client}|${req.method}|${url.pathname}|${key}`;
    const fingerprint = sha256(
      canonicalJson({
        body: await readJson(req),
        applicant: req.headers['x-applicant-ref'] ?? null,
        official: req.headers['x-official-id'] ?? null,
        actor: req.headers['x-actor-ref'] ?? null,
      }),
    );
    const previous = store.recall(scope);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ProblemError(409, 'IDEMPOTENCY_CONFLICT', 'Clé déjà utilisée pour une autre requête');
      return { reply: previous.reply as Reply, client: principal.client, name: route.name };
    }
    const reply = await route.handler(context);
    // Snapshot: the stored case keeps changing, a replay must return what the first call returned.
    const stored = { ...reply, body: JSON.parse(JSON.stringify(reply.body)) };
    store.remember(scope, { fingerprint, reply: stored });
    return { reply: stored, client: principal.client, name: route.name };
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return send(res, { status: 200, body: { status: 'ok', simulated: true } });
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, { status: 200, body: overviewPage(store, exchanges), type: 'text/html; charset=utf-8' });
    }

    const traceId = TRACEPARENT.exec(String(req.headers.traceparent ?? ''))?.[1];
    if (!traceId || /^0+$/.test(traceId)) return problem(res, 400, 'INVALID_REQUEST', 'traceparent W3C v00 requis', '0'.repeat(32));
    try {
      const { reply, client, name } = await dispatch(req, url, traceId);
      record(exchanges, { at: new Date().toISOString(), client: client ?? '-', operation: name ?? '-', status: reply.status, traceId });
      send(res, reply);
    } catch (error) {
      const known = error instanceof ProblemError;
      if (!known) console.error(error);
      const status = known ? error.status : 500;
      record(exchanges, { at: new Date().toISOString(), client: '-', operation: `${req.method} ${url.pathname.replace(/\/(cas|doc|off)_[0-9A-Z]+/g, '/{id}')}`, status, traceId });
      problem(res, status, known ? error.code : 'INVALID_REQUEST', known ? error.message : 'Erreur interne', traceId);
    }
  });

  return {
    server,
    store,
    async listen(): Promise<XroadServer> {
      await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
      const { port } = server.address() as AddressInfo;
      const host = config.host.includes(':') ? `[${config.host}]` : config.host;
      return {
        url: `http://${host}:${port}`,
        store,
        close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
      };
    },
  };
}

function record(exchanges: Exchange[], exchange: Exchange): void {
  exchanges.unshift(exchange);
  exchanges.length = Math.min(exchanges.length, 50);
}

function integerParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw invalid(`${name} doit être un entier entre ${min} et ${max}`);
  return value;
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new ProblemError(413, 'FILE_TOO_LARGE', 'Corps trop volumineux');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw invalid('JSON invalide');
  }
}

function send(res: http.ServerResponse, reply: Reply): void {
  const binary = Buffer.isBuffer(reply.body);
  const payload = binary || typeof reply.body === 'string' ? (reply.body as Buffer | string) : JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    'content-type': reply.type ?? 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

function problem(res: http.ServerResponse, status: number, code: ProblemCode, detail: string, traceId: string): void {
  const headers: Record<string, string> = { 'content-type': 'application/problem+json', 'cache-control': 'no-store' };
  if (status === 401) headers['www-authenticate'] = 'Bearer';
  if (status === 503) headers['retry-after'] = '5';
  res.writeHead(status, headers).end(JSON.stringify({ type: 'about:blank', title: code, status, detail, code, traceId }));
}
