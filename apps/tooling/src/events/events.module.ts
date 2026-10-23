import { Global, Inject, Injectable, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Database } from '../database/database.js';
import { Outbox } from './outbox.js';
import { OutboxPublisher } from './outbox-publisher.js';

/**
 * Entretien périodique, sûr en parallèle sur plusieurs répliques :
 * les clés d'idempotence sont gardées au moins 24 h, puis purgées.
 */
@Injectable()
export class Housekeeping implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(Housekeeping.name);
  private timer?: NodeJS.Timeout;

  constructor(@Inject(Database) private readonly db: Database) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.purge().catch((error: unknown) => this.logger.error(`Purge différée : ${error instanceof Error ? error.message : String(error)}`));
    }, 600_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async purge(): Promise<number> {
    const rows = await this.db.transaction('system', (tx) => tx.query("delete from idempotency_keys where created_at < now() - interval '25 hours' returning key_hash"));
    return rows.length;
  }
}

@Global()
@Module({ providers: [Outbox, OutboxPublisher, Housekeeping], exports: [Outbox] })
export class EventsModule {}
