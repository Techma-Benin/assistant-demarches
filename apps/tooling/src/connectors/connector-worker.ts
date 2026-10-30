import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AuditLog } from '../audit/audit-log.js';
import { ProblemError } from '../common/problem.js';
import type { TraceContext } from '../common/trace.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { Database, type Tx } from '../database/database.js';
import { Outbox } from '../events/outbox.js';
import { ProcedureCatalog } from '../procedures/procedures.module.js';
import { BackendResourcesClient } from '../resources/backend-resources.client.js';
import type { AttachedDocument, Fields, RequestStatus } from '../requests/requests.repository.js';
import { ConnectorRegistry, type AdministrationConnector, type ExternalStatus } from './connector.js';

interface DueRow {
  id: string;
  conversation_id: string;
  user_ref: string;
  procedure_id: string;
  status: RequestStatus;
  fields: Fields;
  documents: AttachedDocument[];
  connector: string;
  mandate_id: string | null;
  external_ref: string | null;
  submission_state: 'queued' | 'sent';
  queued_at: Date | string;
  connector_attempts: number;
}

const BATCH = 20;
const LEASE_SECONDS = 60;
const MAX_BACKOFF_SECONDS = 3600;
const GIVE_UP_MS = 24 * 3600 * 1000;
const ACTOR = 'tooling-connector';
const RANK: Record<string, number> = { awaiting_user_validation: 0, submitted: 1, processing: 2, completed: 3, rejected: 3 };
const TERMINAL = new Set<ExternalStatus>(['completed', 'rejected']);

function newTrace(): TraceContext {
  const traceId = randomBytes(16).toString('hex');
  const parentId = randomBytes(8).toString('hex');
  return { traceparent: `00-${traceId}-${parentId}-01`, traceId, parentId };
}

@Injectable()
export class ConnectorWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ConnectorWorker.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    @Inject(Database) private readonly db: Database,
    private readonly registry: ConnectorRegistry,
    private readonly catalog: ProcedureCatalog,
    private readonly resources: BackendResourcesClient,
    private readonly outbox: Outbox,
    private readonly audit: AuditLog,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.connectors.worker && this.config.connectors.enabled.length) this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  async tick(): Promise<number> {
    const batch = await this.claim();
    for (const row of batch) await this.process(row);
    return batch.length;
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick()
        .then((count) => this.schedule(count === BATCH ? 0 : this.config.connectors.intervalMs))
        .catch((error: unknown) => {
          this.logger.error(`Connecteurs interrompus : ${error instanceof Error ? error.message : String(error)}`);
          this.schedule(Math.max(this.config.connectors.intervalMs, 5000));
        });
    }, delay);
    this.timer.unref();
  }

  private claim(): Promise<DueRow[]> {
    return this.db.transaction('system', async (tx) => {
      const rows = await tx.query<DueRow>(
        `select id, conversation_id, user_ref, procedure_id, status, fields, documents, connector, mandate_id, external_ref, submission_state, queued_at, connector_attempts
         from requests
         where submission_state in ('queued', 'sent') and next_check_at <= now()
         order by next_check_at
         limit $1
         for update skip locked`,
        [BATCH],
      );
      if (rows.length) {
        await tx.query(`update requests set next_check_at = now() + make_interval(secs => $2), connector_attempts = connector_attempts + 1 where id = any($1)`, [
          rows.map((row) => row.id),
          LEASE_SECONDS,
        ]);
      }
      return rows.map((row) => ({ ...row, connector_attempts: row.connector_attempts + 1 }));
    });
  }

  private async process(row: DueRow): Promise<void> {
    const trace = newTrace();
    const connector = this.registry.get(row.connector);
    if (!connector) {
      await this.finish(row, trace, 'failed', 'connector.submit', 'UPSTREAM_UNAVAILABLE', 'connecteur désactivé');
      return;
    }
    try {
      if (row.submission_state === 'queued') await this.submit(row, connector, trace);
      else await this.track(row, connector, trace);
    } catch (error) {
      await this.retry(row, trace, error);
    }
  }

  private async submit(row: DueRow, connector: AdministrationConnector, trace: TraceContext): Promise<void> {
    const refusal = await this.mandateRefusal(row);
    if (refusal) {
      await this.finish(row, trace, 'withdrawn', 'connector.submit', refusal, 'mandat plus valide');
      return;
    }
    const procedure = await this.catalog.get(row.procedure_id, trace);
    const documents = [];
    for (const document of row.documents) {
      documents.push({ documentType: document.documentType, file: await this.resources.getFile(document.fileId, row.user_ref, trace) });
    }
    const result = await connector.submit({ requestId: row.id, userRef: row.user_ref, procedure, fields: row.fields, documents, traceId: trace.traceId });

    await this.db.transaction('system', async (tx) => {
      if (result.kind === 'user_action_required') {
        const updated = await tx.query(`update requests set official_link = $2, submission_state = 'awaiting_user', connector_error = null, updated_at = now() where id = $1 and submission_state = 'queued' returning id`, [
          row.id,
          result.link,
        ]);
        if (updated.length) await this.record(tx, row, trace, 'connector.submit', 'success', 'USER_ACTION_REQUIRED');
        return;
      }
      const updated = await tx.query(
        `update requests set status = 'submitted', external_ref = $2, receipt = $3::jsonb, submission_state = 'sent', connector_attempts = 0, connector_error = null,
           next_check_at = now() + make_interval(secs => $4), updated_at = now()
         where id = $1 and submission_state = 'queued' returning updated_at`,
        [row.id, result.externalRef, JSON.stringify(result.receipt), this.config.connectors.pollMs / 1000],
      );
      if (!updated.length) return;
      await this.changed(tx, row, 'submitted', updated[0].updated_at as Date | string, trace);
      await this.record(tx, row, trace, 'connector.submit', 'success', 'OK');
    });
  }

  private async track(row: DueRow, connector: AdministrationConnector, trace: TraceContext): Promise<void> {
    const status = await connector.status(row.external_ref as string, { requestId: row.id, userRef: row.user_ref, traceId: trace.traceId });
    await this.db.transaction('system', async (tx) => {
      if (RANK[status] <= RANK[row.status]) {
        await tx.query(`update requests set connector_attempts = 0, connector_error = null, next_check_at = now() + make_interval(secs => $2) where id = $1`, [
          row.id,
          this.config.connectors.pollMs / 1000,
        ]);
        return;
      }
      const terminal = TERMINAL.has(status);
      const [updated] = await tx.query<{ updated_at: Date | string }>(
        `update requests set status = $2, submission_state = $3, connector_attempts = 0, connector_error = null,
           next_check_at = case when $3 = 'done' then null else now() + make_interval(secs => $4) end, updated_at = now()
         where id = $1 returning updated_at`,
        [row.id, status, terminal ? 'done' : 'sent', this.config.connectors.pollMs / 1000],
      );
      await this.changed(tx, row, status, updated.updated_at, trace);
      await this.record(tx, row, trace, 'connector.status', 'success', status.toUpperCase());
    });
  }

  private async retry(row: DueRow, trace: TraceContext, error: unknown): Promise<void> {
    const code = error instanceof ProblemError ? error.code : 'UPSTREAM_UNAVAILABLE';
    const action = row.submission_state === 'queued' ? 'connector.submit' : 'connector.status';
    this.logger.warn(`${action} ${row.id} en échec (${code}) : ${error instanceof Error ? error.message : String(error)}`);
    // A refusal by the administration, or a case it no longer knows, will not change on retry.
    if (error instanceof ProblemError && (error.status === 404 || error.status === 409)) {
      await this.finish(row, trace, 'failed', action, code, `refus définitif (${error.message}) ; le lien officiel reste disponible`);
      return;
    }
    if (row.submission_state === 'queued' && Date.now() - new Date(row.queued_at).getTime() > GIVE_UP_MS) {
      await this.finish(row, trace, 'failed', action, code, 'abandon après 24 h ; le lien officiel reste disponible');
      return;
    }
    const backoff = Math.min(2 ** (row.connector_attempts - 1), MAX_BACKOFF_SECONDS);
    await this.db.transaction('system', async (tx) => {
      await tx.query(`update requests set next_check_at = now() + make_interval(secs => $2), connector_error = $3 where id = $1`, [row.id, backoff, code]);
      await this.record(tx, row, trace, action, 'error', code);
    });
  }

  private async finish(row: DueRow, trace: TraceContext, state: 'withdrawn' | 'failed', action: string, code: string, reason: string): Promise<void> {
    this.logger.warn(`${action} ${row.id} : ${reason}`);
    await this.db.transaction('system', async (tx) => {
      await tx.query(`update requests set submission_state = $2, next_check_at = null, connector_error = $3 where id = $1`, [row.id, state, code]);
      await this.record(tx, row, trace, action, 'error', code);
    });
  }

  private async mandateRefusal(row: DueRow): Promise<string | undefined> {
    if (!row.mandate_id) return 'MANDATE_MISSING';
    const [mandate] = await this.db.transaction('system', (tx) =>
      tx.query<{ status: string; expires_at: Date | string }>('select status, expires_at from mandates where id = $1', [row.mandate_id]),
    );
    if (!mandate) return 'MANDATE_MISSING';
    if (mandate.status === 'revoked') return 'MANDATE_REVOKED';
    if (new Date(mandate.expires_at).getTime() <= Date.now()) return 'MANDATE_EXPIRED';
    return undefined;
  }

  private async changed(tx: Tx, row: DueRow, to: RequestStatus, at: Date | string, trace: TraceContext): Promise<void> {
    await this.outbox.enqueue(
      tx,
      { kind: 'request.status_changed', requestId: row.id, conversationId: row.conversation_id, from: row.status, to, at: new Date(at).toISOString() },
      trace.traceId,
    );
    row.status = to;
  }

  private record(tx: Tx, row: DueRow, trace: TraceContext, action: string, outcome: 'success' | 'error', code: string): Promise<void> {
    return this.audit.record(tx, {
      traceId: trace.traceId,
      actor: ACTOR,
      action,
      outcome,
      code,
      conversationId: row.conversation_id,
      userRef: row.user_ref,
      mandateId: row.mandate_id ?? undefined,
      requestId: row.id,
    });
  }
}
