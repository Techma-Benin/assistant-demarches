import { Inject, Injectable, Logger } from '@nestjs/common';
import { sha256 } from '../common/ids.js';
import { Database } from '../database/database.js';

export interface RateDecision {
  allowed: boolean;
  retryAfter: number;
}

const WINDOW_MS = 60_000;

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
