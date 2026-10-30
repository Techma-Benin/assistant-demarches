import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { KeyedRetryRunner } from '../common/retry-runner.js';
import { describeError } from '../common/errors.js';
import { line, loggerFor } from '../common/log.js';
import { INBOUND_PROCESSOR } from '../tokens.js';
import type { WaMessage } from './payload.js';

export interface InboundItem {
  subjectKey: string;
  message: WaMessage;
  /** Nouvelle trace par message entrant ; réutilisée lors des reprises. */
  traceparent: string;
}

export interface InboundHandler {
  process(item: InboundItem, attempt: number): Promise<void>;
}

export interface InboundQueue {
  enqueue(item: InboundItem): void;
}

export interface InboundQueueOptions {
  delayMs?: (failures: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

/** File en mémoire : séquentielle par abonné, 5 tentatives (1/2/4/8/16 s). */
@Injectable()
export class InMemoryInboundQueue implements InboundQueue, OnModuleDestroy {
  private readonly logger = loggerFor('InboundQueue');
  private readonly runner: KeyedRetryRunner;

  constructor(
    @Inject(INBOUND_PROCESSOR) private readonly handler: InboundHandler,
    options: InboundQueueOptions = {},
  ) {
    this.runner = new KeyedRetryRunner({
      delayMs: options.delayMs ?? ((failures) => BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]!),
      maxAttempts: 5,
      ...(options.sleep ? { sleep: options.sleep } : {}),
      onGiveUp: (error, attempts, ref) =>
        this.logger.error(line('inbound.failed', { wamid: ref, attempts, error: describeError(error) })),
    });
  }

  enqueue(item: InboundItem): void {
    this.runner.submit(item.subjectKey, item.message.id, (attempt) => this.handler.process(item, attempt));
  }

  idle(): Promise<void> {
    return this.runner.idle();
  }

  onModuleDestroy(): void {
    this.runner.close();
  }
}
