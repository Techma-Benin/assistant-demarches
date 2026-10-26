import { describe, expect, it, vi } from 'vitest';
import { C1Error } from '../src/backend/c1-client.js';
import { MetaPermanentError, MetaRetryableError, type MetaSender } from '../src/meta/meta.js';
import { InMemoryOutboundQueue, staticJob } from '../src/meta/outbound-queue.js';
import { textMessage } from '../src/rendering/text.js';
import { InMemoryInboundQueue } from '../src/webhook/inbound-queue.js';
import { TRACEPARENT, waText } from './helpers.js';

const noSleep = async () => undefined;

describe('InMemoryOutboundQueue', () => {
  it('conserve l’ordre par conversation et reprend au message en échec', async () => {
    const sent: string[] = [];
    let failures = 2;
    const sender: MetaSender = {
      async send(_to, message) {
        const body = message.type === 'text' ? message.text.body : '';
        if (body === 'deux' && failures-- > 0) throw new MetaRetryableError(503);
        sent.push(body);
      },
    };
    const sleeps: number[] = [];
    const queue = new InMemoryOutboundQueue(sender, { sleep: async (ms) => void sleeps.push(ms) });
    queue.enqueue(staticJob('cnv_1', 'a', '229', [textMessage('un'), textMessage('deux')]));
    queue.enqueue(staticJob('cnv_1', 'b', '229', [textMessage('trois')]));
    await queue.idle();
    expect(sent).toEqual(['un', 'deux', 'trois']);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('abandonne sans reprise sur erreur permanente', async () => {
    const send = vi.fn().mockRejectedValue(new MetaPermanentError(400));
    const queue = new InMemoryOutboundQueue({ send }, { sleep: noSleep });
    queue.enqueue(staticJob('cnv_1', 'a', '229', [textMessage('x')]));
    await queue.idle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('abandonne après 10 tentatives', async () => {
    const send = vi.fn().mockRejectedValue(new MetaRetryableError(500));
    const queue = new InMemoryOutboundQueue({ send }, { sleep: noSleep });
    queue.enqueue(staticJob('cnv_1', 'a', '229', [textMessage('x')]));
    await queue.idle();
    expect(send).toHaveBeenCalledTimes(10);
  });

  it('backoff plafonné à 60 s', async () => {
    const sleeps: number[] = [];
    const queue = new InMemoryOutboundQueue(
      { send: vi.fn().mockRejectedValue(new MetaRetryableError(500)) },
      { sleep: async (ms) => void sleeps.push(ms) },
    );
    queue.enqueue(staticJob('k', 'a', '229', [textMessage('x')]));
    await queue.idle();
    expect(sleeps).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  });

  it('tâche sans destinataire (prepare -> null) : rien envoyé', async () => {
    const send = vi.fn();
    const queue = new InMemoryOutboundQueue({ send }, { sleep: noSleep });
    queue.enqueue({ key: 'k', ref: 'r', prepare: async () => null });
    await queue.idle();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('InMemoryInboundQueue', () => {
  const item = (id: string, from = '229') => ({ subjectKey: from, message: waText('x', id, from), traceparent: TRACEPARENT });

  it('séquentiel par abonné, avec reprises 1/2/4/8/16 s puis abandon après 5 tentatives', async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    const handler = {
      process: vi.fn(async (it: { message: { id: string } }, attempt: number) => {
        calls.push(`${it.message.id}#${attempt}`);
        if (it.message.id === 'a') throw new C1Error(503);
      }),
    };
    const queue = new InMemoryInboundQueue(handler, { sleep: async (ms) => void sleeps.push(ms) });
    queue.enqueue(item('a'));
    queue.enqueue(item('b'));
    await queue.idle();
    expect(calls).toEqual(['a#0', 'a#1', 'a#2', 'a#3', 'a#4', 'b#0']);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
  });

  it('une erreur non retentable n’est pas rejouée', async () => {
    const handler = { process: vi.fn().mockRejectedValue(new Error('bug')) };
    const queue = new InMemoryInboundQueue(handler, { sleep: noSleep });
    queue.enqueue(item('a'));
    await queue.idle();
    expect(handler.process).toHaveBeenCalledTimes(1);
  });
});
