import { randomBytes } from 'node:crypto';
import { Global, Inject, Injectable, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AuditLog } from '../audit/audit-log.js';
import { ProblemError } from '../common/problem.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { Database } from '../database/database.js';
import { Outbox } from '../events/outbox.js';
import { XroadClient } from '../xroad/xroad.client.js';

interface DueRow {
  id: string;
  conversation_id: string;
  user_ref: string;
  case_id: string;
  case_state: string | null;
  check_attempts: number;
}

const BATCH = 20;
const LEASE_SECONDS = 60;
const MAX_BACKOFF_SECONDS = 300;
const TERMINAL = new Set(['completed', 'rejected']);
const ACTOR = 'tooling-tracker';

@Injectable()
export class CaseTracker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CaseTracker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    @Inject(Database) private readonly db: Database,
    private readonly xroad: XroadClient,
    private readonly outbox: Outbox,
    private readonly audit: AuditLog,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.tracking.worker) this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  async tick(): Promise<number> {
    const batch = await this.claim();
    for (const row of batch) await this.check(row);
    return batch.length;
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick()
        .then((count) => this.schedule(count === BATCH ? 0 : this.config.tracking.intervalMs))
        .catch((error: unknown) => {
          this.logger.error(`Suivi interrompu : ${error instanceof Error ? error.message : String(error)}`);
          this.schedule(Math.max(this.config.tracking.intervalMs, 5000));
        });
    }, delay);
    this.timer.unref();
  }

  private claim(): Promise<DueRow[]> {
    return this.db.transaction('system', async (tx) => {
      const rows = await tx.query<DueRow>(
        `select id, conversation_id, user_ref, case_id, case_state, check_attempts from requests
         where case_id is not null and not tracking_done and next_check_at <= now()
         order by next_check_at limit $1 for update skip locked`,
        [BATCH],
      );
      if (rows.length) {
        await tx.query('update requests set next_check_at = now() + make_interval(secs => $2), check_attempts = check_attempts + 1 where id = any($1)', [
          rows.map((row) => row.id),
          LEASE_SECONDS,
        ]);
      }
      return rows.map((row) => ({ ...row, check_attempts: row.check_attempts + 1 }));
    });
  }

  private async check(row: DueRow): Promise<void> {
    const traceId = randomBytes(16).toString('hex');
    try {
      const found = await this.xroad.getCase(row.user_ref, row.case_id, row.id, { traceId });
      const state = `${found.status}|${found.updatedAt}`;
      const done = TERMINAL.has(found.status);
      await this.db.transaction('system', async (tx) => {
        await tx.query(
          `update requests set case_state = $2, tracking_done = $3, check_attempts = 0, tracking_error = null,
             next_check_at = case when $3 then null else now() + make_interval(secs => $4) end
           where id = $1`,
          [row.id, state, done, this.config.tracking.pollMs / 1000],
        );
        if (state === row.case_state) return;
        await this.outbox.enqueue(tx, { kind: 'case.updated', conversationId: row.conversation_id, case: found }, traceId);
        await this.audit.record(tx, {
          traceId,
          actor: ACTOR,
          action: 'case.updated',
          outcome: 'success',
          code: found.status.toUpperCase(),
          conversationId: row.conversation_id,
          userRef: row.user_ref,
          requestId: row.id,
        });
      });
    } catch (error) {
      const code = error instanceof ProblemError ? error.code : 'UPSTREAM_UNAVAILABLE';
      const lost = error instanceof ProblemError && error.status === 404;
      this.logger.warn(`Suivi de ${row.id} en échec (${code}) : ${error instanceof Error ? error.message : String(error)}`);
      const backoff = Math.min(2 ** (row.check_attempts - 1), MAX_BACKOFF_SECONDS);
      await this.db.transaction('system', async (tx) => {
        await tx.query(
          `update requests set tracking_error = $2, tracking_done = $3,
             next_check_at = case when $3 then null else now() + make_interval(secs => $4) end
           where id = $1`,
          [row.id, code, lost, backoff],
        );
        await this.audit.record(tx, { traceId, actor: ACTOR, action: 'case.track', outcome: 'error', code, conversationId: row.conversation_id, userRef: row.user_ref, requestId: row.id });
      });
    }
  }
}

@Global()
@Module({ providers: [CaseTracker], exports: [CaseTracker] })
export class TrackingModule {}
