import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Schemas } from '@techma/contracts-ts';
import { ServiceAuth, requireScope, type Principal } from './auth.js';
import type { SimConfig } from './config.js';
import { domainValidator, errorsText } from './contracts.js';
import { loadCatalogue, type Official } from './data.js';
import { migrate, type Database, type Tx } from './database.js';
import { canonicalJson, sha256 } from './ids.js';
import { ProblemError, forbidden, invalid, notFound, type ProblemCode } from './problem.js';
import { XroadStore, type Caller, type CaseView } from './store.js';
import { overviewPage, type Exchange } from './overview.js';

const TRACEPARENT = /^00-([a-f0-9]{32})-([a-f0-9]{16})-0[01]$/;
const MAX_JSON_BODY = 64 * 1024;
const MAX_UPLOAD = 10 * 1024 * 1024;
const VIEWS = new Set<CaseView>(['pending', 'completed', 'rejected', 'all']);
const UPLOAD_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

interface Context {
  req: http.IncomingMessage;
  url: URL;
  traceId: string;
  principal: Principal;
  params: string[];
  body: unknown;
}

interface Reply {
  status: number;
  body: unknown;
  type?: string;
}

type Handler = (context: Context, tx: Tx) => Promise<Reply> | Reply;

const validators = {
  userRef: domainValidator('UserRef'),
  administrationId: domainValidator('AdministrationId'),
  caseId: domainValidator('CaseId'),
  documentId: domainValidator('DocumentId'),
  officialId: domainValidator('OfficialId'),
  caseInput: domainValidator('CaseInput'),
  responseInput: domainValidator('CaseResponseInput'),
  actionInput: domainValidator('CaseActionInput'),
  paymentInput: domainValidator('PaymentInput'),
  profileUpdate: domainValidator('ProfileUpdate'),
  avatarInput: domainValidator('AvatarInput'),
  registration: domainValidator('OfficialRegistration'),
  officialUpdate: domainValidator('OfficialUpdate'),
};

interface Route {
  method: string;
  pattern: RegExp;
  name: string;
  handler: Handler;
  body?: keyof typeof validators;
  /** Binary body, read as is. */
  binary?: boolean;
  /** Idempotency-Key required: same key and same body give the same reply. */
  idempotent?: boolean;
}

export interface XroadServer {
  url: string;
  store: XroadStore;
  close(): Promise<void>;
}

export function createXroadServer(config: SimConfig, db: Database, now?: () => number) {
  const auth = new ServiceAuth(config);
  const store = new XroadStore(loadCatalogue(config.catalogueFile), now);
  const exchanges: Exchange[] = [];

  const pageOf = (url: URL) => {
    const limit = integerParam(url, 'limit', 20, 1, 100);
    const raw = url.searchParams.get('cursor');
    const offset = raw === null ? 0 : Number(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Number.isInteger(offset) || offset < 0) throw invalid('Curseur invalide');
    return { limit, offset };
  };

  const paged = async <T>(url: URL, fetch: (page: { limit: number; offset: number }) => Promise<{ items: T[]; hasMore: boolean }>): Promise<Reply> => {
    const page = pageOf(url);
    const { items, hasMore } = await fetch(page);
    return { status: 200, body: { items, nextCursor: hasMore ? Buffer.from(String(page.offset + page.limit)).toString('base64url') : null } };
  };

  const applicant = (context: Context): string => {
    requireScope(context.principal, 'xroad:apply');
    const value = context.req.headers['x-applicant-ref'];
    if (typeof value !== 'string' || !validators.userRef(value)) throw invalid('X-Applicant-Ref requis');
    return value;
  };

  const subject = (context: Context): string => {
    requireScope(context.principal, 'xroad:administer');
    const value = context.req.headers['x-official-subject'];
    if (typeof value !== 'string' || value.length < 1 || value.length > 255) throw invalid('X-Official-Subject requis');
    return value;
  };

  const assertActive = (found: Official): Official => {
    if (!found.active) throw forbidden('Compte désactivé');
    return found;
  };

  /** An unregistered person has no access. The profile routes say so with 404 instead (see `self`). */
  const official = async (context: Context, tx: Tx): Promise<Official> => {
    const found = await store.officialBySubject(tx, subject(context));
    if (!found) throw forbidden('Personne inconnue de cette administration');
    return assertActive(found);
  };

  const self = async (context: Context, tx: Tx): Promise<Official> => {
    const found = await store.officialBySubject(tx, subject(context));
    if (!found) throw notFound('Personne inscrite dans aucune administration');
    return assertActive(found);
  };

  /** Case routes accept exactly one identity: the applicant or an official. */
  const caller = async (context: Context, tx: Tx): Promise<Caller> => {
    const hasApplicant = context.req.headers['x-applicant-ref'] !== undefined;
    const hasOfficial = context.req.headers['x-official-subject'] !== undefined;
    if (hasApplicant === hasOfficial) throw invalid('Exactement un en-tête requis : X-Applicant-Ref ou X-Official-Subject');
    if (hasApplicant) return { kind: 'applicant', applicantRef: applicant(context) };
    return { kind: 'official', official: await official(context, tx) };
  };

  const filter = (url: URL): string | undefined => {
    const value = url.searchParams.get('administrationId') ?? undefined;
    if (value !== undefined && !validators.administrationId(value)) throw invalid('administrationId invalide');
    return value;
  };

  const dateParam = (url: URL, name: string): string | undefined => {
    const value = url.searchParams.get(name) ?? undefined;
    if (value !== undefined && Number.isNaN(Date.parse(value))) throw invalid(`${name} doit être une date ISO 8601`);
    return value === undefined ? undefined : new Date(value).toISOString();
  };

  const pathId = (value: string, validate: (typeof validators)[keyof typeof validators], label: string) => {
    if (!validate(value)) throw notFound(`${label} inconnu`);
    return value;
  };

  const reader = (context: Context) => requireScope(context.principal, 'xroad:apply', 'xroad:administer');

  const routes: Route[] = [
    {
      method: 'GET',
      pattern: /^\/v1\/administrations$/,
      name: 'xroadListAdministrations',
      handler: (context) => {
        reader(context);
        return { status: 200, body: { items: store.listAdministrations() } };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/procedures$/,
      name: 'xroadSearchProcedures',
      handler: (context) => {
        reader(context);
        const query = context.url.searchParams.get('query') ?? undefined;
        if (query !== undefined && !query.trim()) throw invalid('query vide');
        const assisted = context.url.searchParams.get('assisted');
        if (assisted !== null && assisted !== 'true' && assisted !== 'false') throw invalid('assisted doit valoir true ou false');
        const limit = integerParam(context.url, 'limit', 20, 1, 100);
        const items = store.searchProcedures(query, filter(context.url), assisted === null ? undefined : assisted === 'true').slice(0, limit);
        return { status: 200, body: { items, nextCursor: null } };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/procedures\/([^/]+)$/,
      name: 'xroadGetProcedure',
      handler: (context) => {
        reader(context);
        return { status: 200, body: store.getProcedure(decodeURIComponent(context.params[0])) };
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/uploads$/,
      name: 'xroadUpload',
      binary: true,
      handler: async (context, tx) => {
        const applicantRef = applicant(context);
        const mimeType = context.req.headers['x-file-mime-type'];
        if (typeof mimeType !== 'string' || !UPLOAD_TYPES.has(mimeType)) throw new ProblemError(415, 'UNSUPPORTED_MEDIA_TYPE', 'PDF, JPEG ou PNG attendu');
        const content = context.body as Buffer;
        if (content.length === 0) throw invalid('Pièce vide');
        return { status: 201, body: await store.upload(tx, applicantRef, mimeType as Schemas['Upload']['mimeType'], content) };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/cases$/,
      name: 'xroadListCases',
      handler: async (context, tx) => {
        const who = await caller(context, tx);
        const view = (context.url.searchParams.get('view') ?? 'all') as CaseView;
        if (!VIEWS.has(view)) throw invalid('view doit valoir pending, completed, rejected ou all');
        return paged(context.url, (page) => store.listCases(tx, who, filter(context.url), view, page));
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/cases$/,
      name: 'xroadCreateCase',
      body: 'caseInput',
      idempotent: true,
      handler: async (context, tx) => ({ status: 201, body: await store.createCase(tx, applicant(context), context.body as Schemas['CaseInput']) }),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/cases\/([^/]+)$/,
      name: 'xroadGetCase',
      handler: async (context, tx) => ({ status: 200, body: await store.getCase(tx, await caller(context, tx), pathId(context.params[0], validators.caseId, 'Dossier')) }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/cases\/([^/]+)\/payment$/,
      name: 'xroadPayCase',
      body: 'paymentInput',
      idempotent: true,
      handler: async (context, tx) => ({ status: 200, body: await store.pay(tx, applicant(context), pathId(context.params[0], validators.caseId, 'Dossier')) }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/cases\/([^/]+)\/responses$/,
      name: 'xroadRespondToCase',
      body: 'responseInput',
      idempotent: true,
      handler: async (context, tx) => ({
        status: 200,
        body: await store.respond(tx, applicant(context), pathId(context.params[0], validators.caseId, 'Dossier'), context.body as Schemas['CaseResponseInput']),
      }),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/cases\/([^/]+)\/actions$/,
      name: 'xroadActOnCase',
      body: 'actionInput',
      idempotent: true,
      handler: async (context, tx) => {
        const input = context.body as Schemas['CaseActionInput'];
        return { status: 200, body: await store.act(tx, await official(context, tx), pathId(context.params[0], validators.caseId, 'Dossier'), input.action, input.note) };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/cases\/([^/]+)\/documents\/([^/]+)$/,
      name: 'xroadDownloadDocument',
      handler: async (context, tx) => {
        const found = await store.document(
          tx,
          await caller(context, tx),
          pathId(context.params[0], validators.caseId, 'Dossier'),
          pathId(context.params[1], validators.documentId, 'Document'),
        );
        return { status: 200, body: found.content, type: found.mimeType };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/officials\/me$/,
      name: 'xroadGetMe',
      handler: async (context, tx) => ({ status: 200, body: store.me(await self(context, tx)) }),
    },
    {
      method: 'PUT',
      pattern: /^\/v1\/officials\/me$/,
      name: 'xroadUpdateMe',
      body: 'profileUpdate',
      handler: async (context, tx) => ({ status: 200, body: await store.updateProfile(tx, await self(context, tx), context.body as Schemas['ProfileUpdate']) }),
    },
    {
      method: 'PUT',
      pattern: /^\/v1\/officials\/me\/avatar$/,
      name: 'xroadSetAvatar',
      body: 'avatarInput',
      handler: async (context, tx) => ({ status: 200, body: await store.setAvatar(tx, await self(context, tx), (context.body as Schemas['AvatarInput']).avatarUrl) }),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/officials$/,
      name: 'xroadListOfficials',
      handler: async (context, tx) => {
        const viewer = await official(context, tx);
        return paged(context.url, (page) => store.listOfficials(tx, viewer, filter(context.url), page));
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/officials$/,
      name: 'xroadCreateOfficial',
      body: 'registration',
      idempotent: true,
      handler: async (context, tx) => ({ status: 201, body: await store.createOfficial(tx, await official(context, tx), context.body as Schemas['OfficialRegistration']) }),
    },
    {
      method: 'PUT',
      pattern: /^\/v1\/officials\/([^/]+)$/,
      name: 'xroadUpdateOfficial',
      body: 'officialUpdate',
      handler: async (context, tx) => ({
        status: 200,
        body: await store.updateOfficial(tx, await official(context, tx), pathId(context.params[0], validators.officialId, 'Agent'), context.body as Schemas['OfficialUpdate']),
      }),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/metrics$/,
      name: 'xroadGetMetrics',
      handler: async (context, tx) => ({
        status: 200,
        body: await store.metrics(tx, await official(context, tx), filter(context.url), dateParam(context.url, 'from'), dateParam(context.url, 'to')),
      }),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/activity$/,
      name: 'xroadListActivity',
      handler: async (context, tx) => {
        const viewer = await official(context, tx);
        const caseId = context.url.searchParams.get('caseId') ?? undefined;
        if (caseId !== undefined && !validators.caseId(caseId)) throw invalid('caseId invalide');
        return paged(context.url, (page) => store.activity(tx, viewer, filter(context.url), caseId, page));
      },
    },
  ];

  const findRoute = (method: string | undefined, pathname: string): Route => {
    // /v1/officials/me is listed before /v1/officials/{id}: first match wins.
    const route = routes.find((candidate) => candidate.method === method && candidate.pattern.test(pathname));
    if (route) return route;
    const known = routes.some((candidate) => candidate.pattern.test(pathname));
    throw new ProblemError(known ? 400 : 404, known ? 'INVALID_REQUEST' : 'NOT_FOUND', known ? 'Méthode non prise en charge' : 'Route inconnue');
  };

  const readRouteBody = async (req: http.IncomingMessage, route: Route): Promise<unknown> => {
    if (route.binary) {
      const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/octet-stream') throw new ProblemError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Corps binaire attendu');
      return readRaw(req, MAX_UPLOAD);
    }
    if (!route.body) return undefined;
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw new ProblemError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Corps JSON attendu');
    let body: unknown;
    try {
      body = JSON.parse((await readRaw(req, MAX_JSON_BODY)).toString('utf8'));
    } catch (error) {
      if (error instanceof ProblemError) throw error;
      throw invalid('JSON invalide');
    }
    const validate = validators[route.body];
    if (!validate(body)) throw invalid(`Corps invalide : ${errorsText(validate)}`);
    return body;
  };

  const dispatch = async (req: http.IncomingMessage, url: URL, traceId: string): Promise<{ reply: Reply; client: string; name: string }> => {
    const route = findRoute(req.method, url.pathname);
    const principal = await auth.authenticate(req.headers.authorization);
    // Read before the transaction: a slow client must not hold a database connection.
    const body = await readRouteBody(req, route);
    const context: Context = { req, url, traceId, principal, params: route.pattern.exec(url.pathname)!.slice(1), body };
    const named = (reply: Reply) => ({ reply, client: principal.client, name: route.name });

    if (!route.idempotent) return named(await db.transaction((tx) => Promise.resolve(route.handler(context, tx))));

    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) throw invalid('Idempotency-Key de 8 à 128 caractères requise');
    const scope = `${principal.client}|${req.method}|${url.pathname}|${key}`;
    const fingerprint = sha256(
      canonicalJson({
        body,
        applicant: req.headers['x-applicant-ref'] ?? null,
        official: req.headers['x-official-subject'] ?? null,
      }),
    );
    return named(
      await db.transaction(async (tx) => {
        await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [scope]);
        const previous = await store.recall(tx, scope);
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new ProblemError(409, 'IDEMPOTENCY_CONFLICT', 'Clé déjà utilisée pour une autre requête');
          return previous.reply as Reply;
        }
        const reply = await route.handler(context, tx);
        await store.remember(tx, scope, { fingerprint, reply: { status: reply.status, body: reply.body } });
        return reply;
      }),
    );
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return send(res, { status: 200, body: { status: 'ok', simulated: true } });

    const incoming = TRACEPARENT.exec(String(req.headers.traceparent ?? ''));
    const traceId = incoming && !/^0+$/.test(incoming[1]) ? incoming[1] : randomBytes(16).toString('hex');
    const traceparent = incoming && incoming[1] === traceId ? incoming[0] : `00-${traceId}-${randomBytes(8).toString('hex')}-01`;
    res.setHeader('traceparent', traceparent);
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        const counts = await db.transaction((tx) => store.overview(tx));
        return send(res, { status: 200, body: overviewPage(store, counts, exchanges), type: 'text/html; charset=utf-8' });
      }
      const { reply, client, name } = await dispatch(req, url, traceId);
      record(exchanges, { at: new Date().toISOString(), client, operation: name, status: reply.status, traceId });
      send(res, reply);
    } catch (error) {
      const unique = (error as { code?: unknown })?.code === '23505';
      const known = error instanceof ProblemError;
      if (!known && !unique) console.error(error);
      const status = known ? error.status : unique ? 409 : 500;
      const code: ProblemCode = known ? error.code : unique ? 'CONFLICT' : 'INVALID_REQUEST';
      record(exchanges, { at: new Date().toISOString(), client: '-', operation: `${req.method} ${url.pathname.replace(/\/(cas|doc|off)_[0-9A-Z]+/g, '/{id}')}`, status, traceId });
      req.resume();
      problem(res, status, code, known ? error.message : unique ? 'Cette ressource existe déjà' : 'Erreur interne', traceId);
    }
  });

  return {
    server,
    store,
    async listen(): Promise<XroadServer> {
      await migrate(db);
      await db.transaction((tx) => store.seedDirectory(tx));
      await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
      const { port } = server.address() as AddressInfo;
      const host = config.host.includes(':') ? `[${config.host}]` : config.host;
      return {
        url: `http://${host}:${port}`,
        store,
        close: () =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeAllConnections();
          }),
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

async function readRaw(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  if (Number(req.headers['content-length'] ?? 0) > limit) throw new ProblemError(413, 'FILE_TOO_LARGE', 'Corps trop volumineux');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new ProblemError(413, 'FILE_TOO_LARGE', 'Corps trop volumineux');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
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
