import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { INBOUND_QUEUE } from '../src/tokens.js';
import { extractMessages } from '../src/webhook/payload.js';
import { signBody, verifyMetaSignature } from '../src/webhook/signature.js';
import { APP_SECRET, VERIFY_TOKEN, buildApp, metaPayload, sign, silenceLogs, waText } from './helpers.js';

beforeAll(silenceLogs);

describe('signature Meta (unitaire)', () => {
  const raw = Buffer.from('{"a": 1}');
  it('accepte une signature valide', () => {
    expect(verifyMetaSignature(APP_SECRET, raw, signBody(APP_SECRET, raw))).toBe(true);
  });
  it('refuse absente, mal formée, mauvaise valeur, mauvais secret', () => {
    expect(verifyMetaSignature(APP_SECRET, raw, undefined)).toBe(false);
    expect(verifyMetaSignature(APP_SECRET, raw, 'sha256=zz')).toBe(false);
    expect(verifyMetaSignature(APP_SECRET, raw, signBody(APP_SECRET, raw).replace('sha256=', 'sha1='))).toBe(false);
    expect(verifyMetaSignature(APP_SECRET, raw, `sha256=${'0'.repeat(64)}`)).toBe(false);
    expect(verifyMetaSignature('autre', raw, signBody(APP_SECRET, raw))).toBe(false);
  });
});

describe('extractMessages', () => {
  it('ignore les statuses', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'x', changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.S', status: 'delivered' }] } }] }],
    };
    expect(extractMessages(payload)).toEqual([]);
  });
  it('extrait les messages et ignore les charges inattendues', () => {
    expect(extractMessages(metaPayload([waText('Bonjour')]))).toHaveLength(1);
    expect(extractMessages({ object: 'page' })).toEqual([]);
    expect(extractMessages(null)).toEqual([]);
  });
});

describe('webhook Meta (HTTP)', () => {
  let app: NestExpressApplication;
  const enqueue = vi.fn();
  const setup = async () => {
    enqueue.mockReset();
    app = await buildApp({ overrides: { [INBOUND_QUEUE]: { enqueue } } });
    return request(app.getHttpServer());
  };
  afterEach(async () => {
    await app?.close();
  });

  it('GET : bon jeton -> challenge en text/plain', async () => {
    const http = await setup();
    const res = await http
      .get('/webhooks/meta')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toBe('1158201444');
  });

  it('GET : mauvais jeton, mauvais mode ou paramètres absents -> 403', async () => {
    const http = await setup();
    for (const q of [
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'faux', 'hub.challenge': 'c' },
      { 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'c' },
      {},
    ]) {
      const res = await http.get('/webhooks/meta').query(q);
      expect(res.status).toBe(403);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    }
  });

  it('POST : signature valide -> 200 et message mis en file', async () => {
    const http = await setup();
    const raw = JSON.stringify(metaPayload([waText('Bonjour')]), null, 2);
    const res = await http.post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(raw)).send(raw);
    expect(res.status).toBe(200);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const item = enqueue.mock.calls[0]![0];
    expect(item.subjectKey).toMatch(/^[0-9a-f]{64}$/);
    expect(item.message.id).toBe('wamid.TEST1');
    expect(item.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  });

  it('POST : signature absente, mal formée ou fausse -> 401, rien traité', async () => {
    const http = await setup();
    const raw = JSON.stringify(metaPayload([waText('Bonjour')]));
    const send = (sig?: string) => {
      const r = http.post('/webhooks/meta').set('Content-Type', 'application/json');
      if (sig) r.set('X-Hub-Signature-256', sig);
      return r.send(raw);
    };
    for (const sig of [undefined, 'sha256=abc', `sha256=${'a'.repeat(64)}`, sign('autre corps')]) {
      const res = await send(sig);
      expect(res.status).toBe(401);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.code).toBe('UNAUTHORIZED');
    }
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('POST : la signature porte sur les octets bruts (re-sérialisation refusée)', async () => {
    const http = await setup();
    const payload = metaPayload([waText('Bonjour')]);
    const pretty = JSON.stringify(payload, null, 2);
    const compact = JSON.stringify(payload);
    const res = await http.post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(pretty)).send(compact);
    expect(res.status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('POST : corps de plus de 256 Kio -> 413', async () => {
    const http = await setup();
    const raw = JSON.stringify({ pad: 'x'.repeat(300 * 1024) });
    const res = await http.post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(raw)).send(raw);
    expect(res.status).toBe(413);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('POST : JSON invalide mais correctement signé -> 400', async () => {
    const http = await setup();
    const raw = '{pas du json';
    const res = await http.post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(raw)).send(raw);
    expect(res.status).toBe(400);
  });

  it('POST : les statuses sont ignorés', async () => {
    const http = await setup();
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'x', changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.S', status: 'read' }] } }] }],
    });
    const res = await http.post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(raw)).send(raw);
    expect(res.status).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
