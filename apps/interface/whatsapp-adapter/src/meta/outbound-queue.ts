import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { OutboundMessage } from '../rendering/types.js';
import { KeyedRetryRunner } from '../common/retry-runner.js';
import { describeError } from '../common/errors.js';
import { line, loggerFor } from '../common/log.js';
import { META_SENDER } from '../tokens.js';
import type { MetaSender } from './meta.js';

export interface OutboundTarget {
  to: string;
  messages: OutboundMessage[];
}

export interface OutboundJob {
  /** Clé d’ordre : identifiant de conversation. */
  key: string;
  /** Référence de journal (id d’événement, wamid) : jamais de numéro. */
  ref: string;
  /** Résout destinataire et messages (une seule fois) ; null = rien à envoyer (job abandonné). */
  prepare(): Promise<OutboundTarget | null>;
}

export interface OutboundQueue {
  enqueue(job: OutboundJob): void;
}

export const staticJob = (key: string, ref: string, to: string, messages: OutboundMessage[]): OutboundJob => ({
  key,
  ref,
  prepare: async () => ({ to, messages }),
});

export interface OutboundQueueOptions {
  delayMs?: (failures: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

const backoff = (failures: number) => Math.min(60_000, 1000 * 2 ** (failures - 1));

/**
 * File d’envoi en mémoire : ordre conservé par conversation, reprise là où l’envoi a échoué,
 * 1/2/4/…/60 s, 10 tentatives. BullMQ/Redis dans une tâche ultérieure.
 */
@Injectable()
export class InMemoryOutboundQueue implements OutboundQueue, OnModuleDestroy {
  private readonly logger = loggerFor('OutboundQueue');
  private readonly runner: KeyedRetryRunner;

  constructor(
    @Inject(META_SENDER) private readonly sender: MetaSender,
    options: OutboundQueueOptions = {},
  ) {
    this.runner = new KeyedRetryRunner({
      delayMs: options.delayMs ?? backoff,
      maxAttempts: 10,
      ...(options.sleep ? { sleep: options.sleep } : {}),
      onGiveUp: (error, attempts, ref) =>
        this.logger.error(line('outbound.failed', { ref, attempts, error: describeError(error) })),
    });
  }

  enqueue(job: OutboundJob): void {
    let target: OutboundTarget | null | undefined;
    let sent = 0;
    this.runner.submit(job.key, job.ref, async () => {
      if (target === undefined) target = await job.prepare();
      if (target === null) return;
      while (sent < target.messages.length) {
        await this.sender.send(target.to, target.messages[sent]!);
        sent += 1;
      }
    });
  }

  idle(): Promise<void> {
    return this.runner.idle();
  }

  onModuleDestroy(): void {
    this.runner.close();
  }
}
