import { Body, Controller, HttpCode, Inject, Logger, Module, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuditLog } from '../audit/audit-log.js';
import { RequestGuard } from '../auth/request-guard.js';
import { ProblemError, toProblem } from '../common/problem.js';
import { traceOf, type TraceContext } from '../common/trace.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { ConnectorRegistry, type ExternalCase } from '../connectors/connector.js';
import { domainValidator } from '../contracts.js';
import { Database, type Tx } from '../database/database.js';
import { Idempotency, type IdempotencyKey } from '../idempotency/idempotency.js';
import { RequestWorkflow, type DepartmentRequest, type WorkflowRow } from '../requests/request-workflow.js';

type Action = 'claim' | 'request_information' | 'approve' | 'reject' | 'resume';

interface Command {
  action: Action;
  revision: number;
  reason?: string;
  departmentId: string;
  actorRef: string;
}

const validateCommand = domainValidator('InternalAdminCommand');
const REQUEST_ID = /^req_[0-9A-HJKMNP-TV-Z]{26}$/;
const NOT_FILED = new Set(['draft', 'ready', 'awaiting_user_validation', 'cancelled']);
const CLOSED = new Set(['completed', 'rejected']);

@Controller('internal/v1/admin/requests')
export class AdminRequestsController {
  private readonly logger = new Logger(AdminRequestsController.name);

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    @Inject(Database) private readonly db: Database,
    private readonly guard: RequestGuard,
    private readonly idempotency: Idempotency,
    private readonly audit: AuditLog,
    private readonly workflow: RequestWorkflow,
    private readonly registry: ConnectorRegistry,
  ) {}

  @Post(':id/actions')
  @HttpCode(200)
  async act(@Req() req: Request, @Param('id') id: string, @Body() body: unknown): Promise<DepartmentRequest> {
    const principal = await this.guard.authorize(req, 'backend-admin', 'requests:admin');
    const trace = traceOf(req);
    const action = validateCommand(body) ? `admin.${(body as Command).action}` : 'admin.action';
    return this.audited(trace, principal.client, action, id, async () => {
      if (!this.config.snapshots || !REQUEST_ID.test(id)) throw new ProblemError(404, 'NOT_FOUND', 'Dossier inconnu');
      if (!validateCommand(body)) throw new ProblemError(400, 'INVALID_REQUEST', 'Commande administrative invalide');
      const command = body as Command;
      const header = req.headers['idempotency-key'];
      const key = this.idempotency.keyFor({ actor: principal.client, method: 'POST', route: `/internal/v1/admin/requests/${id}/actions`, key: typeof header === 'string' ? header : undefined }, command);

      const prior = await this.db.transaction('system', (tx) => this.idempotency.lookup(tx, key));
      if (prior) return this.replayed(trace, principal.client, action, prior.response as DepartmentRequest);

      const row = await this.db.transaction('system', (tx) => this.workflow.load(tx, id));
      this.check(row, command);
      const decided = command.action === 'approve' || command.action === 'reject' ? await this.decide(row, command, key, trace) : undefined;

      return this.db.transaction('system', async (tx) => {
        const reservation = await this.idempotency.reserve(tx, key);
        if (reservation.kind === 'replay') return reservation.response as DepartmentRequest;
        const current = await this.workflow.load(tx, id, true);
        this.check(current, command);
        await this.apply(tx, id, command, decided);
        const { snapshot } = await this.workflow.restate(tx, id, trace.traceId, action, command.actorRef);
        if (!snapshot) throw new ProblemError(404, 'NOT_FOUND', 'Dossier inconnu');
        await this.audit.record(tx, { traceId: trace.traceId, actor: principal.client, action, outcome: 'success', code: 'OK', conversationId: current.conversation_id, userRef: current.user_ref, requestId: id });
        await this.idempotency.complete(tx, reservation.keyHash, snapshot);
        return snapshot;
      });
    });
  }

  private check(row: WorkflowRow, command: Command): void {
    if (row.administration_id !== command.departmentId) throw new ProblemError(404, 'NOT_FOUND', 'Dossier inconnu');
    if (row.revision !== command.revision) throw new ProblemError(409, 'INVALID_TRANSITION', 'Dossier modifié entre-temps : recharger la révision courante');
    if (NOT_FILED.has(row.status)) throw new ProblemError(409, 'INVALID_TRANSITION', 'Dossier pas encore déposé auprès de l’administration');
    if (CLOSED.has(row.status)) throw new ProblemError(409, 'INVALID_TRANSITION', 'Dossier déjà clos');
    switch (command.action) {
      case 'claim':
        if (row.assigned_to === command.actorRef) throw new ProblemError(409, 'INVALID_TRANSITION', 'Dossier déjà pris en charge par cet agent');
        return;
      case 'request_information':
        if (!command.reason) throw new ProblemError(400, 'INVALID_REQUEST', 'Motif requis pour demander un complément');
        if (row.information_request) throw new ProblemError(409, 'INVALID_TRANSITION', 'Un complément est déjà demandé');
        return;
      case 'resume':
        if (!row.information_request) throw new ProblemError(409, 'INVALID_TRANSITION', 'Aucun complément en attente');
        return;
      default:
        if (row.external_state?.stage !== 'in_review') throw new ProblemError(409, 'INVALID_TRANSITION', "Ce dossier n'attend pas de décision de l'administration");
    }
  }

  private async decide(row: WorkflowRow, command: Command, key: IdempotencyKey, trace: TraceContext): Promise<ExternalCase> {
    const connector = row.connector ? this.registry.get(row.connector) : undefined;
    if (!connector?.decide || !row.external_ref) throw new ProblemError(409, 'INVALID_TRANSITION', "Décision non transmissible à l'administration pour ce dossier");
    return connector.decide(
      row.external_ref,
      { decision: command.action as 'approve' | 'reject', note: command.reason ?? null, actorRef: command.actorRef, idempotencyKey: `admin-${key.keyHash.slice(0, 48)}` },
      { requestId: row.id, userRef: row.user_ref, traceId: trace.traceId },
    );
  }

  private async apply(tx: Tx, id: string, command: Command, decided: ExternalCase | undefined): Promise<void> {
    switch (command.action) {
      case 'claim':
        await tx.query('update requests set assigned_to = $2, updated_at = now() where id = $1', [id, command.actorRef]);
        return;
      case 'request_information':
        await tx.query('update requests set assigned_to = $2, information_request = $3::jsonb, updated_at = now() where id = $1', [
          id,
          command.actorRef,
          JSON.stringify({ detail: command.reason, at: new Date().toISOString(), by: command.actorRef }),
        ]);
        return;
      case 'resume':
        await tx.query('update requests set assigned_to = $2, information_request = null, updated_at = now() where id = $1', [id, command.actorRef]);
        return;
      default:
        await tx.query(
          `update requests set assigned_to = $2, information_request = null, external_state = $3::jsonb, updated_at = now(),
             submission_state = 'sent', next_check_at = now()
           where id = $1`,
          [id, command.actorRef, JSON.stringify(decided)],
        );
    }
  }

  private async replayed(trace: TraceContext, actor: string, action: string, snapshot: DepartmentRequest): Promise<DepartmentRequest> {
    await this.db.transaction('system', (tx) =>
      this.audit.record(tx, { traceId: trace.traceId, actor, action, outcome: 'success', code: 'REPLAY', requestId: snapshot.id, userRef: snapshot.userRef as string }),
    );
    return snapshot;
  }

  private async audited<T>(trace: TraceContext, actor: string, action: string, id: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const { code } = toProblem(error);
      await this.db
        .transaction('system', (tx) => this.audit.record(tx, { traceId: trace.traceId, actor, action, outcome: 'error', code, ...(REQUEST_ID.test(id) ? { requestId: id } : {}) }))
        .catch((failure) => this.logger.error(`Refus non journalisé (${action}, ${code}) : ${failure instanceof Error ? failure.message : String(failure)}`));
      throw error;
    }
  }
}

@Module({ controllers: [AdminRequestsController] })
export class AdminModule {}
