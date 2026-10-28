import type { NestExpressApplication } from '@nestjs/platform-express';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { DevCallbackTokenVerifier, JoseCallbackTokenVerifier } from '../src/callback/callback-auth.js';

import { CALLBACK_TOKEN_VERIFIER, CONVERSATION_DIRECTORY, OUTBOUND_QUEUE } from '../src/tokens.js';
import type { ConversationDirectory } from '../src/storage/stores.js';
import {
  RecordingOutboundQueue,
  TRACEPARENT,
  WA_ID,
  buildApp,
  contractValidator,
  fixtureEvent,
  testConfig,
  textsOf,
} from './helpers.js';

const CONVERSATION = 'cnv_00000000000000000000000001';
const KEY = 'idempotency-key-1';
let app: NestExpressApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup(options: Parameters<typeof buildApp>[0] = {}) {
  const queue = new RecordingOutboundQueue();
  app = await buildApp({ ...options, overrides: { [OUTBOUND_QUEUE]: queue, ...options.overrides } });
  return { queue, http: request(app.getHttpServer()) };
}

interface PostOptions {
  token?: string | null;
  traceparent?: string | null;
  key?: string | null;
  contentType?: string;
}
const post = (http: ReturnType<typeof request>, body: unknown, o: PostOptions = {}) => {
  const r = http.post('/v1/callbacks/events').set('Content-Type', o.contentType ?? 'application/json');
  const token = o.token === undefined ? 'mock-backend-delivery' : o.token;
  if (token) r.set('Authorization', `Bearer ${token}`);
  const traceparent = o.traceparent === undefined ? TRACEPARENT : o.traceparent;
  if (traceparent) r.set('traceparent', traceparent);
  const key = o.key === undefined ? KEY : o.key;
  if (key) r.set('Idempotency-Key', key);
  return r.send(typeof body === 'string' ? body : JSON.stringify(body));
};

describe('récepteur de rappel C4 (jeton de développement)', () => {
  it('204 puis une seule tâche d’envoi ; doublon : 204 sans nouvelle tâche', async () => {
    const { http, queue } = await setup();
    const event = fixtureEvent();
    expect((await post(http, event)).status).toBe(204);
    expect(queue.jobs).toHaveLength(1);
    expect((await post(http, event)).status).toBe(204);
    expect(queue.jobs).toHaveLength(1);
  });

  it('un doublon avec un ordre de clés différent reste un doublon', async () => {
    const { http, queue } = await setup();
    const event = fixtureEvent();
    const reordered = Object.fromEntries(Object.entries(event).reverse());
    expect((await post(http, event)).status).toBe(204);
    expect((await post(http, reordered)).status).toBe(204);
    expect(queue.jobs).toHaveLength(1);
  });

  it('204 est rendu avant tout envoi Meta : la tâche ne fait que s’enregistrer', async () => {
    const { http, queue } = await setup();
    expect((await post(http, fixtureEvent())).status).toBe(204);
    expect(queue.jobs[0]!.key).toBe(CONVERSATION);
    expect(queue.jobs[0]!.ref).toBe(fixtureEvent().id);
  });

  it('même identifiant, corps différent : 409 IDEMPOTENCY_CONFLICT', async () => {
    const { http, queue } = await setup();
    const event = fixtureEvent();
    await post(http, event);
    const other = structuredClone(event);
    (other.data.message!.blocks[0] as { text: string }).text = 'Autre texte';
    const res = await post(http, other);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(queue.jobs).toHaveLength(1);
  });

  it('événement autre que message.sent : 400', async () => {
    const { http, queue } = await setup();
    const received = {
      ...fixtureEvent(),
      id: 'evt_00000000000000000000000002',
      type: 'bj.techma.message.received.v1',
      data: { kind: 'message.received', conversationId: CONVERSATION, messageId: 'msg_00000000000000000000000001' },
    };
    const res = await post(http, received);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
    expect(queue.jobs).toHaveLength(0);
  });

  it('Event invalide ou type incohérent avec data.kind : 400', async () => {
    const { http } = await setup();
    expect((await post(http, {})).status).toBe(400);
    expect((await post(http, { ...fixtureEvent(), extra: 1 })).status).toBe(400);
    expect((await post(http, { ...fixtureEvent(), type: 'bj.techma.message.received.v1' })).status).toBe(400);
    expect((await post(http, '{pas du json')).status).toBe(400);
  });

  it('traceparent absent, mal formé ou nul : 400', async () => {
    const { http } = await setup();
    const event = fixtureEvent();
    for (const traceparent of [null, 'abc', `00-${'0'.repeat(32)}-${'2'.repeat(16)}-01`, `00-${'1'.repeat(32)}-${'0'.repeat(16)}-01`, `01-${'1'.repeat(32)}-${'2'.repeat(16)}-01`]) {
      expect((await post(http, event, { traceparent })).status, String(traceparent)).toBe(400);
    }
  });

  it('Idempotency-Key absent ou hors de 8 à 128 caractères : 400', async () => {
    const { http } = await setup();
    const event = fixtureEvent();
    for (const key of [null, 'court', 'x'.repeat(129)]) {
      expect((await post(http, event, { key })).status, String(key)).toBe(400);
    }
    expect((await post(http, event, { key: 'x'.repeat(128) })).status).toBe(204);
  });

  it('jeton absent ou inconnu : 401 ; l’erreur ne répète jamais le jeton', async () => {
    const { http, queue } = await setup();
    expect((await post(http, fixtureEvent(), { token: null })).status).toBe(401);
    const res = await post(http, fixtureEvent(), { token: 'jeton-secret-xyz' });
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('jeton-secret-xyz');
    expect(queue.jobs).toHaveLength(0);
  });

  it('corps de plus de 1 Mio : 400 INVALID_REQUEST « Corps trop volumineux »', async () => {
    const { http } = await setup();
    const res = await post(http, JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 10) }));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_REQUEST', detail: 'Corps trop volumineux' });
  });

  it('autre type de contenu que JSON : 415', async () => {
    const { http } = await setup();
    expect((await post(http, 'x', { contentType: 'text/plain' })).status).toBe(415);
  });

  it('les erreurs sont du application/problem+json conforme au schéma Problem', async () => {
    const { http } = await setup();
    const validateProblem = contractValidator('Problem');
    const bad = await post(http, {}, { traceparent: TRACEPARENT });
    expect(bad.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(validateProblem(bad.body), JSON.stringify(validateProblem.errors)).toBe(true);
    expect(bad.body.traceId).toBe('1'.repeat(32));
    const noTrace = await post(http, fixtureEvent(), { token: null, traceparent: null });
    expect(validateProblem(noTrace.body)).toBe(true);
    expect(noTrace.body.traceId).toBe('0'.repeat(32));
  });

  it('la tâche retrouve le numéro, rend le message et le met en file', async () => {
    const { http, queue } = await setup();
    await (app!.get(CONVERSATION_DIRECTORY) as ConversationDirectory).save('abc', WA_ID, CONVERSATION);
    await post(http, fixtureEvent());
    const target = await queue.jobs[0]!.prepare();
    expect(target!.to).toBe(WA_ID);
    expect(textsOf(target)).toEqual([
      'Simulation : cette démarche est fictive.\n\nSources :\n• example.org — version demo-1, consultée le 22/10/2026 : https://example.org/demonstration',
    ]);
  });

  it('conversation inconnue : tâche abandonnée sans envoi', async () => {
    const { http, queue } = await setup();
    await post(http, fixtureEvent());
    expect(await queue.jobs[0]!.prepare()).toBeNull();
  });
});

describe('récepteur de rappel C4 (production)', () => {
  it('refuse le jeton statique de simulation', async () => {
    const config = testConfig({
      isProduction: true,
      nodeEnv: 'production',
      backendUrl: 'https://backend.example.org',
      mockUserToken: undefined as never,
      meta: { appSecret: 's', verifyToken: 'v', accessToken: 'a', phoneNumberId: 'p', graphVersion: 'v23.0', useGraphApi: true },
      callback: { jwksUrl: 'https://idp.example.org/jwks', issuer: 'https://idp.example.org/realms/techma' },
    });
    const { http } = await setup({ config });
    const res = await post(http, fixtureEvent());
    expect(res.status).toBe(401);
    expect((await http.get('/dev/outbox')).status).toBe(404);
    expect((await http.get('/health')).body).toEqual({ status: 'ok' });
  });

  it('le vérificateur de développement refuse tout en mode production', async () => {
    await expect(new DevCallbackTokenVerifier(true).verify('mock-backend-delivery')).rejects.toMatchObject({ kind: 'UNAUTHORIZED' });
    await expect(new DevCallbackTokenVerifier(false).verify('mock-backend-delivery')).resolves.toBeUndefined();
    await expect(new DevCallbackTokenVerifier(false).verify('autre')).rejects.toMatchObject({ kind: 'UNAUTHORIZED' });
  });
});

describe('récepteur de rappel C4 (JWT RS256 + JWKS local)', () => {
  const ISSUER = 'https://idp.example.org/realms/techma';
  let privateKey: CryptoKey;
  let verifier: JoseCallbackTokenVerifier;
  let otherKey: CryptoKey;

  const prepare = async () => {
    const pair = await generateKeyPair('RS256');
    const other = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    otherKey = other.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    verifier = new JoseCallbackTokenVerifier(createLocalJWKSet({ keys: [jwk] }), ISSUER);
  };

  const token = (
    claims: Record<string, unknown> = { scope: 'messages:deliver other', azp: 'backend-delivery' },
    o: { aud?: string; iss?: string; exp?: string | number | null; key?: CryptoKey; alg?: string } = {},
  ) => {
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: o.alg ?? 'RS256', kid: 'k1' })
      .setIssuer(o.iss ?? ISSUER)
      .setAudience(o.aud ?? 'whatsapp-adapter')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600);
    if (o.exp !== null) jwt.setExpirationTime(o.exp ?? '5m');
    return jwt.sign(o.key ?? privateKey);
  };


  it('jeton valide : 204', async () => {
    await prepare();
    const { http, queue } = await setup({ overrides: { [CALLBACK_TOKEN_VERIFIER]: verifier } });
    expect((await post(http, fixtureEvent(), { token: await token() })).status).toBe(204);
    expect(queue.jobs).toHaveLength(1);
  });

  it('azp absent mais scope présent : accepté', async () => {
    await prepare();
    const { http } = await setup({ overrides: { [CALLBACK_TOKEN_VERIFIER]: verifier } });
    expect((await post(http, fixtureEvent(), { token: await token({ scope: 'messages:deliver' }) })).status).toBe(204);
  });

  it('401 : mauvaise audience, mauvais émetteur, expiré, sans exp, mauvaise clé, jeton statique', async () => {
    await prepare();
    const { http, queue } = await setup({ overrides: { [CALLBACK_TOKEN_VERIFIER]: verifier } });
    const valid = { scope: 'messages:deliver', azp: 'backend-delivery' };
    const cases: Record<string, string> = {
      audience: await token(valid, { aud: 'autre-service' }),
      issuer: await token(valid, { iss: 'https://evil.example.org' }),
      expired: await token(valid, { exp: Math.floor(Date.now() / 1000) - 120 }),
      noExp: await token(valid, { exp: null }),
      badKey: await token(valid, { key: otherKey }),
      static: 'mock-backend-delivery',
      garbage: 'a.b.c',
    };
    for (const [name, jwt] of Object.entries(cases)) {
      const res = await post(http, fixtureEvent(), { token: jwt });
      expect(res.status, name).toBe(401);
      expect(res.body.code, name).toBe('UNAUTHORIZED');
    }
    expect(queue.jobs).toHaveLength(0);
  });

  it('403 : scope manquant ou azp incorrect', async () => {
    await prepare();
    const { http, queue } = await setup({ overrides: { [CALLBACK_TOKEN_VERIFIER]: verifier } });
    for (const claims of [{ scope: 'conversation:relay' }, {}, { scope: 'messages:deliverx' }, { scope: 'messages:deliver', azp: 'autre-client' }]) {
      const res = await post(http, fixtureEvent(), { token: await token(claims) });
      expect(res.status, JSON.stringify(claims)).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    expect(queue.jobs).toHaveLength(0);
  });

  it('refuse un algorithme autre que RS256', async () => {
    await prepare();
    const hs = new SignJWT({ scope: 'messages:deliver' })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience('whatsapp-adapter')
      .setExpirationTime('5m');
    const jwt = await hs.sign(new TextEncoder().encode('0'.repeat(32)));
    await expect(verifier.verify(jwt)).rejects.toMatchObject({ kind: 'UNAUTHORIZED' });
  });
});

