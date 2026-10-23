import { Inject, Injectable, Logger } from '@nestjs/common';
import { sha256 } from '../common/ids.js';
import { Database } from '../database/database.js';

export interface RateDecision {
  allowed: boolean;
  /** Secondes jusqu'à la fenêtre suivante. */
  retryAfter: number;
}

const WINDOW_MS = 60_000;

/**
 * Compteurs à fenêtre fixe d'une minute, partagés en base : la limite vaut pour
 * l'ensemble des processus et des répliques et survit aux redémarrages. Les clés
 * sont hachées : ni adresse IP ni userRef en clair dans la table.
 * Si la base ne répond pas, la limite laisse passer : le service est de toute façon
 * en 503 sur les opérations qui touchent la base.
 */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);

  constructor(@Inject(Database) private readonly db: Database) {}

  async hit(bucket: string, limit: number): Promise<RateDecision> {
    const { windowStart, retryAfter } = this.window();
    try {
      const [row] = await this.db.transaction('system', (tx) =>
        tx.query<{ hits: number }>(
          `insert into rate_limits (bucket, window_start, hits) values ($1, $2, 1)
           on conflict (bucket, window_start) do update set hits = rate_limits.hits + 1
           returning hits`,
          [sha256(bucket), windowStart],
        ),
      );
      return { allowed: row.hits <= limit, retryAfter };
    } catch (error) {
      this.logger.warn(`Limite non appliquée : ${error instanceof Error ? error.message : String(error)}`);
      return { allowed: true, retryAfter };
    }
  }

  /** Lecture sans incrément, pour bloquer avant même de vérifier une identité. */
  async exceeded(bucket: string, limit: number): Promise<RateDecision> {
    const { windowStart, retryAfter } = this.window();
    try {
      const [row] = await this.db.transaction('system', (tx) =>
        tx.query<{ hits: number }>('select hits from rate_limits where bucket = $1 and window_start = $2', [sha256(bucket), windowStart]),
      );
      return { allowed: (row?.hits ?? 0) < limit, retryAfter };
    } catch {
      return { allowed: true, retryAfter };
    }
  }

  private window(): { windowStart: string; retryAfter: number } {
    const now = Date.now();
    const start = Math.floor(now / WINDOW_MS) * WINDOW_MS;
    return { windowStart: new Date(start).toISOString(), retryAfter: Math.max(1, Math.ceil((start + WINDOW_MS - now) / 1000)) };
  }
}
