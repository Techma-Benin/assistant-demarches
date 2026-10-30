import { pathToFileURL } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpC1Client } from '../src/backend/c1-client.js';
import type { C1Context } from '../src/backend/c1-client.js';
import { subjectKeyFor } from '../src/common/crypto.js';
import type { ContractEvent, MessageInput } from '../src/contracts/types.js';
import type { RecordingMetaSender } from '../src/meta/fakes.js';
import type { InMemoryOutboundQueue } from '../src/meta/outbound-queue.js';
import type { ConversationDirectory } from '../src/storage/stores.js';
import {
  C1_CLIENT,
  CONVERSATION_DIRECTORY,
  INBOUND_QUEUE,
  OUTBOUND_QUEUE,
  RECORDING_META_SENDER,
} from '../src/tokens.js';
import type { InMemoryInboundQueue } from '../src/webhook/inbound-queue.js';
import { REPO_ROOT, WA_ID, buildApp, metaPayload, sign, testConfig, TRACEPARENT } from './helpers.js';

class SpyC1 extends HttpC1Client {
  readonly sent: MessageInput[] = [];
  override async sendMessage(ctx: C1Context, conversationId: string, input: MessageInput): Promise<void> {
    this.sent.push(input);
    return super.sendMessage(ctx, conversationId, input);
  }
}

interface Mocks {
  backendUrl: string;
  close(): Promise<void>;
}

describe('bout en bout contre le mock Backend', () => {
  let mocks: Mocks;
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let c1: SpyC1;
  const config = () => testConfig({ backendUrl: mocks.backendUrl });

  beforeAll(async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(`${REPO_ROOT}mocks/server.mjs`).href)) as {
      startMocks(o: { backendPort: number; toolingPort: number }): Promise<Mocks>;
    };
    mocks = await mod.startMocks({ backendPort: 0, toolingPort: 0 });
    const cfg = config();
    c1 = new SpyC1(cfg.backendUrl);
    app = await buildApp({ config: cfg, overrides: { [C1_CLIENT]: c1 } });
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    await mocks?.close();
  });

  const webhook = async (messages: Parameters<typeof metaPayload>[0]) => {
    const raw = JSON.stringify(metaPayload(messages));
    const res = await http.post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(raw)).send(raw);
    expect(res.status).toBe(200);
    await (app.get(INBOUND_QUEUE) as InMemoryInboundQueue).idle();
  };
  const conversationId = async () => {
    const id = await (app.get(CONVERSATION_DIRECTORY) as ConversationDirectory).getBySubject(subjectKeyFor(config().subjectHmacKey, WA_ID));
    expect(id).toBeDefined();
    return id!;
  };
  const events = async (id: string): Promise<ContractEvent[]> => {
    const res = await fetch(`${mocks.backendUrl}/v1/conversations/${id}/events`, {
      headers: { Authorization: 'Bearer mock-user', traceparent: TRACEPARENT },
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: ContractEvent[] }).items;
  };
  const deliver = async (event: ContractEvent) => {
    const res = await http
      .post('/v1/callbacks/events')
      .set('Authorization', 'Bearer mock-backend-delivery')
      .set('traceparent', event.traceparent)
      .set('Idempotency-Key', event.id)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(res.status).toBe(204);
    await (app.get(OUTBOUND_QUEUE) as InMemoryOutboundQueue).idle();
  };
  const recorded = () => (app.get(RECORDING_META_SENDER) as RecordingMetaSender).list();

  it('message texte : conversation créée, message transmis, réponse de l’agent renvoyée vers WhatsApp', async () => {
    await webhook([{ from: WA_ID, id: 'wamid.E2E1', timestamp: '1760000000', type: 'text', text: { body: 'Bonjour' } }]);
    const id = await conversationId();
    expect(c1.sent.at(-1)!.content).toEqual({ type: 'text', text: 'Bonjour' });

    const list = await events(id);
    const kinds = list.map((e) => e.data.kind);
    expect(kinds).toContain('message.received');
    expect(kinds).toContain('message.sent');

    // Le même message relivré par Meta ne crée ni nouvel événement ni nouvel envoi.
    await webhook([{ from: WA_ID, id: 'wamid.E2E1', timestamp: '1760000000', type: 'text', text: { body: 'Bonjour' } }]);
    expect((await events(id)).filter((e) => e.data.kind === 'message.sent')).toHaveLength(1);

    const sent = list.find((e) => e.data.kind === 'message.sent')!;
    await deliver(sent);
    await deliver(sent); // doublon : pas de second envoi
    const out = recorded().filter((r) => r.to === WA_ID);
    expect(out).toHaveLength(1);
    const message = out[0]!.message;
    expect(message.type).toBe('text');
    if (message.type === 'text') {
      expect(message.text.body).toContain('Simulation : cette démarche est fictive.');
      expect(message.text.body).toContain('• example.org - version demo-1, consultée le 22/10/2026 : https://example.org/demonstration');
    }
  });

  it('image : média factice -> /v1/files du mock -> message avec fileId', async () => {
    const upload = await http.post('/dev/media/media-e2e-1').set('Content-Type', 'image/png').send(Buffer.from('fake-png-bytes'));
    expect(upload.status).toBe(204);
    const before = c1.sent.length;
    await webhook([
      { from: WA_ID, id: 'wamid.E2E2', timestamp: '1760000100', type: 'image', image: { id: 'media-e2e-1', mime_type: 'image/png' } },
    ]);
    expect(c1.sent).toHaveLength(before + 1);
    const content = c1.sent.at(-1)!.content;
    expect(content).toMatchObject({ type: 'image' });
    expect((content as { fileId: string }).fileId).toMatch(/^fil_[0-9A-HJKMNP-TV-Z]{26}$/);
    const id = await conversationId();
    const received = (await events(id)).filter((e) => e.data.kind === 'message.received');
    expect(received.length).toBeGreaterThanOrEqual(2);
  });

  it('/dev/outbox masque les numéros', async () => {
    const res = await http.get('/dev/outbox');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].to).toBe('+229••••••67');
    expect(JSON.stringify(res.body)).not.toContain(WA_ID);
  });
});
