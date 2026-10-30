import { Logger, type LoggerService } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { C1Error, type C1Client, type C1Context } from '../src/backend/c1-client.js';
import type { InMemoryOutboundQueue } from '../src/meta/outbound-queue.js';
import type { InMemoryInboundQueue } from '../src/webhook/inbound-queue.js';
import { C1_CLIENT, INBOUND_QUEUE, OUTBOUND_QUEUE } from '../src/tokens.js';
import { APP_SECRET, WA_ID, buildApp, fixtureEvent, metaPayload, sign, waText } from './helpers.js';

const SECRET_TEXT = 'Mon-message-confidentiel-98765';
const CONVERSATION = 'cnv_0000000000000000000000000A';

class CaptureLogger implements LoggerService {
  readonly lines: string[] = [];
  private push(...args: unknown[]) {
    this.lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  }
  log = (...a: unknown[]) => this.push(...a);
  error = (...a: unknown[]) => this.push(...a);
  warn = (...a: unknown[]) => this.push(...a);
  debug = (...a: unknown[]) => this.push(...a);
  verbose = (...a: unknown[]) => this.push(...a);
  fatal = (...a: unknown[]) => this.push(...a);
}

class FailingC1 implements C1Client {
  async createConversation(): Promise<{ id: string }> {
    return { id: CONVERSATION };
  }
  async sendMessage(_ctx: C1Context, _id: string, input: { content: { type: string } }): Promise<void> {
    if (input.content.type === 'interaction') throw new C1Error(400);
  }
  async uploadFile(): Promise<never> {
    throw new C1Error(0);
  }
}

describe('confidentialité des journaux', () => {
  const capture = new CaptureLogger();
  const written: string[] = [];
  let app: NestExpressApplication;
  const spies: ReturnType<typeof vi.spyOn>[] = [];

  beforeAll(async () => {
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      spies.push(vi.spyOn(console, method).mockImplementation((...a: unknown[]) => void written.push(a.map(String).join(' '))));
    }
    for (const stream of [process.stdout, process.stderr]) {
      spies.push(
        vi.spyOn(stream, 'write').mockImplementation(((chunk: string | Uint8Array) => {
          written.push(String(chunk));
          return true;
        }) as never),
      );
    }
    Logger.overrideLogger(capture);
    app = await buildApp({ logger: capture, overrides: { [C1_CLIENT]: new FailingC1() } });
  });

  afterAll(async () => {
    await app.close();
    spies.forEach((s) => s.mockRestore());
    Logger.overrideLogger(false);
  });

  afterEach(() => undefined);

  it('un message entrant, un rappel et des erreurs ne journalisent ni numéro, ni texte, ni jeton, ni secret', async () => {
    const http = request(app.getHttpServer());
    const send = async (messages: ReturnType<typeof waText>[]) => {
      const raw = JSON.stringify(metaPayload(messages));
      const signature = sign(raw);
      const res = await http.post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature).send(raw);
      expect(res.status).toBe(200);
      return signature;
    };
    const signature = await send([waText(SECRET_TEXT, 'wamid.P1')]);
    // Types non pris en charge, image sans média (erreur réseau simulée), signature invalide, rappel.
    await send([{ from: WA_ID, id: 'wamid.P2', timestamp: '1760000000', type: 'sticker' }]);
    await send([{ from: WA_ID, id: 'wamid.P3', timestamp: '1760000000', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'x', title: SECRET_TEXT } } }]);
    await http.post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=bad').send('{}');
    const event = fixtureEvent();
    event.data.conversationId = CONVERSATION;
    event.data.message!.conversationId = CONVERSATION;
    const callback = await http
      .post('/v1/callbacks/events')
      .set('Authorization', 'Bearer mock-backend-delivery')
      .set('traceparent', `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`)
      .set('Idempotency-Key', 'privacy-key-123')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
    expect(callback.status).toBe(204);
    await http.post('/v1/callbacks/events').set('Authorization', 'Bearer jeton-inconnu-777').send('{}');

    await (app.get(INBOUND_QUEUE) as InMemoryInboundQueue).idle();
    await (app.get(OUTBOUND_QUEUE) as InMemoryOutboundQueue).idle();

    const all = [...capture.lines, ...written].join('\n');
    expect(capture.lines.length).toBeGreaterThan(0);
    for (const forbidden of [WA_ID, SECRET_TEXT, 'mock-backend-delivery', 'jeton-inconnu-777', APP_SECRET, signature, 'Simulation : cette démarche', '+' + WA_ID]) {
      expect(all, forbidden).not.toContain(forbidden);
    }
  });
});
