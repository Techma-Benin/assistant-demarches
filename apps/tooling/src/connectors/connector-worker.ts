import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AuditLog } from '../audit/audit-log.js';
import { canonicalJson } from '../common/ids.js';
import { ProblemError } from '../common/problem.js';
import type { TraceContext } from '../common/trace.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { Database, type Tx } from '../database/database.js';
import { ProcedureCatalog } from '../procedures/procedures.module.js';
import { BackendResourcesClient } from '../resources/backend-resources.client.js';
import { RequestWorkflow, type RelayedDocument } from '../requests/request-workflow.js';
import type { AttachedDocument, Fields } from '../requests/requests.repository.js';
import { ConnectorRegistry, type AdministrationConnector, type ExternalCase } from './connector.js';

interface DueRow {
  id: string;
  conversation_id: string;
  user_ref: string;
  procedure_id: string;
  fields: Fields;
  documents: AttachedDocument[];
  connector: string;
  mandate_id: string | null;
  external_ref: string | null;
  external_state: ExternalCase | null;
  issued_documents: RelayedDocument[];
  processing_days: number | null;
  submission_state: 'queued' | 'sent';
  queued_at: Date | string;
  connector_attempts: number;
}

interface Relayed {
  documents: RelayedDocument[];
  added: number;
  pending: number;
}

const BATCH = 20;
const LEASE_SECONDS = 60;
const MAX_BACKOFF_SECONDS = 3600;
const DOCUMENT_RETRY_SECONDS = 30;
const GIVE_UP_MS = 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const ACTOR = 'tooling-connector';
const TERMINAL = new Set<ExternalCase['stage']>(['completed', 'rejected']);

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
    private readonly workflow: RequestWorkflow,
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
        `select id, conversation_id, user_ref, procedure_id, fields, documents, connector, mandate_id, external_ref, external_state, issued_documents,
           processing_days, submission_state, queued_at, connector_attempts
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

    if (result.kind === 'user_action_required') {
      await this.db.transaction('system', async (tx) => {
        const updated = await tx.query(`update requests set official_link = $2, submission_state = 'awaiting_user', connector_error = null, updated_at = now() where id = $1 and submission_state = 'queued' returning id`, [
          row.id,
          result.link,
        ]);
        if (!updated.length) return;
        await this.workflow.publish(tx, row.id, trace.traceId, 'request.user_action_required');
        await this.record(tx, row, trace, 'connector.submit', 'success', 'USER_ACTION_REQUIRED');
      });
      return;
    }

    const relayed = await this.relay(row, connector, result.externalRef, result.state, trace);
    const receivedAt = Date.parse(result.receipt.receivedAt);
    const dueAt = row.processing_days === null ? null : new Date(receivedAt + row.processing_days * DAY_MS).toISOString();
    await this.db.transaction('system', async (tx) => {
      const updated = await tx.query(
        `update requests set external_ref = $2, receipt = $3::jsonb, submitted_at = $4, due_at = $5, external_state = $6::jsonb, issued_documents = $7::jsonb,
           connector_attempts = 0, connector_error = null, updated_at = now()
         where id = $1 and submission_state = 'queued' returning id`,
        [row.id, result.externalRef, JSON.stringify(result.receipt), result.receipt.receivedAt, dueAt, JSON.stringify(result.state), JSON.stringify(relayed.documents)],
      );
      if (!updated.length) return;
      await this.planNextCheck(tx, row.id, result.state, relayed);
      await this.workflow.restate(tx, row.id, trace.traceId, 'request.submitted');
      await this.record(tx, row, trace, 'connector.submit', 'success', 'OK');
    });
  }

  private async track(row: DueRow, connector: AdministrationConnector, trace: TraceContext): Promise<void> {
    const state = await connector.status(row.external_ref as string, { requestId: row.id, userRef: row.user_ref, traceId: trace.traceId });
    const relayed = await this.relay(row, connector, row.external_ref as string, state, trace);
    const changed = relayed.added > 0 || row.external_state === null || canonicalJson(state) !== canonicalJson(row.external_state);
    await this.db.transaction('system', async (tx) => {
      const [current] = await tx.query<{ external_state: ExternalCase | null }>('select external_state from requests where id = $1 for update', [row.id]);
      if (canonicalJson(current?.external_state ?? null) !== canonicalJson(row.external_state)) {
        // Paid or decided from the console while the X-Road answered: that answer may predate the change. Ask again.
        await tx.query(`update requests set next_check_at = now() where id = $1`, [row.id]);
        return;
      }
      await tx.query(`update requests set connector_attempts = 0, connector_error = null where id = $1`, [row.id]);
      await this.planNextCheck(tx, row.id, state, relayed);
      if (!changed) return;
      await tx.query(`update requests set external_state = $2::jsonb, issued_documents = $3::jsonb, updated_at = now() where id = $1`, [
        row.id,
        JSON.stringify(state),
        JSON.stringify(relayed.documents),
      ]);
      const { from, to } = await this.workflow.restate(tx, row.id, trace.traceId, relayed.added > 0 ? 'request.documents_issued' : 'request.tracked');
      await this.record(tx, row, trace, 'connector.status', 'success', from === to ? 'UPDATED' : to.toUpperCase());
    });
  }

  private async planNextCheck(tx: Tx, id: string, state: ExternalCase, relayed: Relayed): Promise<void> {
    const terminal = TERMINAL.has(state.stage);
    const late = state.completedAt !== undefined && Date.now() - Date.parse(state.completedAt) > GIVE_UP_MS;
    if (terminal && relayed.pending > 0 && late) this.logger.error(`Demande ${id} : ${relayed.pending} document(s) délivré(s) non transmis après 24 h`);
    if (terminal && (relayed.pending === 0 || late)) {
      await tx.query(`update requests set submission_state = 'done', next_check_at = null where id = $1`, [id]);
      return;
    }
    const delayMs = relayed.pending > 0 ? Math.min(DOCUMENT_RETRY_SECONDS * 1000, this.config.connectors.pollMs) : this.config.connectors.pollMs;
    await tx.query(`update requests set submission_state = 'sent', next_check_at = now() + make_interval(secs => $2) where id = $1`, [id, delayMs / 1000]);
  }

  private async relay(row: DueRow, connector: AdministrationConnector, externalRef: string, state: ExternalCase, trace: TraceContext): Promise<Relayed> {
    const documents = [...row.issued_documents];
    if (!this.workflow.snapshots || !connector.document) return { documents, added: 0, pending: 0 };
    let added = 0;
    let pending = 0;
    for (const issued of state.documents) {
      if (documents.some((document) => document.sourceId === issued.id)) continue;
      try {
        const bytes = await connector.document(externalRef, issued.id, { requestId: row.id, userRef: row.user_ref, traceId: trace.traceId });
        const stored = await this.resources.storeIssuedDocument(row.id, row.user_ref, { bytes, mimeType: issued.mimeType, idempotencyKey: `issued-${issued.id}` }, trace);
        documents.push({ sourceId: issued.id, fileId: stored.id, name: issued.name, mimeType: issued.mimeType, createdAt: issued.issuedAt, expiresAt: stored.expiresAt });
        added += 1;
      } catch (error) {
        pending += 1;
        this.logger.warn(`Document délivré ${issued.id} de ${row.id} non transmis : ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { documents, added, pending };
  }

  private async retry(row: DueRow, trace: TraceContext, error: unknown): Promise<void> {
    const code = error instanceof ProblemError ? error.code : 'UPSTREAM_UNAVAILABLE';
    const action = row.submission_state === 'queued' ? 'connector.submit' : 'connector.status';
    this.logger.warn(`${action} ${row.id} en échec (${code}) : ${error instanceof Error ? error.message : String(error)}`);
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
