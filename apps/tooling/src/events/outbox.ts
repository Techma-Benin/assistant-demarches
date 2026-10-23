import { Injectable } from '@nestjs/common';
import { newId } from '../common/ids.js';
import { childTraceparent } from '../common/trace.js';
import { domainValidator } from '../contracts.js';
import type { Tx } from '../database/database.js';

export type EventData = { kind: string } & Record<string, unknown>;

const validateEvent = domainValidator('Event');

function conversationOf(data: EventData): string {
  const nested = (data.request ?? data.mandate) as { conversationId?: unknown } | undefined;
  const id = data.conversationId ?? nested?.conversationId;
  if (typeof id !== 'string') throw new Error(`Événement ${data.kind} sans conversation`);
  return id;
}

@Injectable()
export class Outbox {
  async enqueue(tx: Tx, data: EventData, traceId: string): Promise<string> {
    const event = {
      specversion: '1.0',
      id: newId('evt'),
      source: 'urn:techma:tooling',
      type: `bj.techma.${data.kind}.v1`,
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      traceparent: childTraceparent({ traceId }),
      data,
    };
    if (!validateEvent(event)) throw new Error(`Événement ${data.kind} non conforme`);
    await tx.query('insert into outbox (id, conversation_id, event) values ($1, $2, $3::jsonb)', [event.id, conversationOf(data), JSON.stringify(event)]);
    return event.id;
  }
}
