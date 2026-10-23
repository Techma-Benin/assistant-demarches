import { Global, Inject, Injectable, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Database } from '../database/database.js';
import { Outbox } from './outbox.js';
import { OutboxPublisher } from './outbox-publisher.js';

/**
 * Entretien périodique, sûr en parallèle sur plusieurs répliques :
 * les clés d'idempotence sont gardées au moins 24 h, les compteurs de débit 10 minutes.
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
    return this.db.transaction('system', async (tx) => {
      const keys = await tx.query("delete from idempotency_keys where created_at < now() - interval '25 hours' returning key_hash");
      const windows = await tx.query("delete from rate_limits where window_start < now() - interval '10 minutes' returning bucket");
      return keys.length + windows.length;
    });
  }
}

@Global()
@Module({ providers: [Outbox, OutboxPublisher, Housekeeping], exports: [Outbox] })
export class EventsModule {}
