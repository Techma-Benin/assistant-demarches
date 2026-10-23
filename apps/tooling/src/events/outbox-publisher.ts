import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ServiceTokens } from '../auth/service-tokens.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { Database } from '../database/database.js';

interface Claimed {
  seq: string;
  id: string;
  event: { traceparent: string };
  attempts: number;
  created_at: Date | string;
}

type Outcome = { kind: 'published' } | { kind: 'retry'; reason: string; afterSeconds?: number } | { kind: 'dead'; reason: string };

const BATCH = 50;
const LEASE_SECONDS = 60;
const MAX_BACKOFF_SECONDS = 60;
const GIVE_UP_MS = 24 * 3600 * 1000;
// Refus définitifs : l'événement ne passera jamais tel quel.
const PERMANENT = new Set([400, 409, 413, 415, 422]);

/**
 * Livre l'outbox au Backend (events.openapi.json). Plusieurs processus peuvent tourner :
 * chaque lot est réservé par SKIP LOCKED puis protégé par un bail ; si un processus
 * s'arrête en cours de route, le bail expire et un autre reprend. Seul l'événement le plus
 * ancien de chaque conversation est éligible, ce qui conserve l'ordre par conversation.
 */
@Injectable()
export class OutboxPublisher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    @Inject(Database) private readonly db: Database,
    private readonly tokens: ServiceTokens,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.events.publisher) this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  /** Un passage complet ; exposé pour les tests et l'exploitation. */
  async tick(): Promise<number> {
    const batch = await this.claim();
    await Promise.all(batch.map(async (row) => this.settle(row, await this.deliver(row))));
    return batch.length;
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick()
        .then((count) => this.schedule(count === BATCH ? 0 : this.config.events.intervalMs))
        .catch((error: unknown) => {
          // Une panne (base, réseau) ne doit jamais arrêter la boucle : on réessaie plus tard.
          this.logger.error(`Publication interrompue : ${error instanceof Error ? error.message : String(error)}`);
          this.schedule(Math.max(this.config.events.intervalMs, 5000));
        });
    }, delay);
    this.timer.unref();
  }

  private claim(): Promise<Claimed[]> {
    return this.db.transaction('system', async (tx) => {
      const rows = await tx.query<Claimed>(
        `with heads as (
           select distinct on (conversation_id) seq from outbox
           where published_at is null and dead_at is null
           order by conversation_id, seq
         )
         select o.seq, o.id, o.event, o.attempts, o.created_at
         from outbox o join heads h on h.seq = o.seq
         where o.available_at <= now()
         order by o.seq
         limit $1
         for update of o skip locked`,
        [BATCH],
      );
      if (rows.length) {
        await tx.query(`update outbox set available_at = now() + make_interval(secs => $2), attempts = attempts + 1 where seq = any($1::bigint[])`, [
          rows.map((row) => row.seq),
          LEASE_SECONDS,
        ]);
      }
      return rows.map((row) => ({ ...row, attempts: row.attempts + 1 }));
    });
  }

  private async deliver(row: Claimed): Promise<Outcome> {
    let res: Response;
    try {
      res = await fetch(new URL('internal/v1/events', this.config.backendUrl.href.replace(/\/?$/, '/')), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.tokens.get('tooling-events')}`,
          'Content-Type': 'application/json',
          traceparent: row.event.traceparent,
          // L'identifiant d'événement est stable : le Backend déduplique les reprises.
          'Idempotency-Key': row.id,
        },
        body: JSON.stringify(row.event),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      return { kind: 'retry', reason: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network' };
    }
    if (res.status === 202) return { kind: 'published' };
    if (res.status === 401 || res.status === 403) {
      this.tokens.invalidate('tooling-events');
      this.logger.error(`Backend refuse l'identité tooling-events (HTTP ${res.status}) : configuration à corriger`);
    }
    if (PERMANENT.has(res.status)) return { kind: 'dead', reason: `HTTP ${res.status}` };
    const retryAfter = Number(res.headers.get('retry-after'));
    return { kind: 'retry', reason: `HTTP ${res.status}`, afterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 3600) : undefined };
  }

  private async settle(row: Claimed, outcome: Outcome): Promise<void> {
    await this.db.transaction('system', async (tx) => {
      if (outcome.kind === 'published') {
        await tx.query('update outbox set published_at = now(), last_error = null where seq = $1', [row.seq]);
        return;
      }
      const tooOld = Date.now() - new Date(row.created_at).getTime() > GIVE_UP_MS;
      if (outcome.kind === 'dead' || tooOld) {
        this.logger.error(`Événement ${row.id} en file d'échec : ${outcome.reason}`);
        await tx.query('update outbox set dead_at = now(), last_error = $2 where seq = $1', [row.seq, outcome.reason]);
        return;
      }
      const backoff = outcome.afterSeconds ?? Math.min(2 ** (row.attempts - 1), MAX_BACKOFF_SECONDS);
      await tx.query('update outbox set available_at = now() + make_interval(secs => $2), last_error = $3 where seq = $1', [row.seq, backoff, outcome.reason]);
    });
  }
}
