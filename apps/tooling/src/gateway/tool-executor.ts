import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditLog, type AuditEntry } from '../audit/audit-log.js';
import { RateLimiter } from '../auth/rate-limiter.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { ProblemError, toProblem } from '../common/problem.js';
import type { TraceContext } from '../common/trace.js';
import { errorsText, tools, type ToolContext } from '../contracts.js';
import { Database } from '../database/database.js';
import { Outbox, type EventData } from '../events/outbox.js';
import { Idempotency } from '../idempotency/idempotency.js';
import { MandatesRepository } from '../mandates/mandates.repository.js';
import { ToolRegistry, type ToolInvocation } from './tool-registry.js';

export interface ToolCall {
  name: string;
  args: unknown;
  context: ToolContext;
  trace: TraceContext;
  /** Client de service authentifié. */
  actor: string;
  idempotencyKey?: string;
}

/**
 * Chemin unique de tout appel d'outil : validation, idempotence, mandat, exécution,
 * contrôle de sortie, puis journal et événements dans la même transaction.
 * Un échec annule l'effet ; il est journalisé dans une transaction séparée.
 */
@Injectable()
export class ToolExecutor {
  private readonly logger = new Logger(ToolExecutor.name);

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    @Inject(Database) private readonly db: Database,
    private readonly limits: RateLimiter,
    private readonly registry: ToolRegistry,
    private readonly idempotency: Idempotency,
    private readonly mandates: MandatesRepository,
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
  ) {}

  async execute(call: ToolCall): Promise<Record<string, unknown>> {
    let mandateId: string | undefined;
    try {
      // Protège contre une boucle de l'agent : limite par usager, tous outils confondus.
      const quota = await this.limits.hit(`user:${call.context.userRef}`, this.config.rateLimits.perUser);
      if (!quota.allowed) throw new ProblemError(429, 'RATE_LIMITED', "Trop d'appels d'outils pour cet usager", quota.retryAfter);
      const tool = tools.get(call.name);
      if (!tool) throw new ProblemError(404, 'NOT_FOUND', 'Outil inconnu');
      if (!tool.input(call.args)) throw new ProblemError(400, 'INVALID_REQUEST', errorsText(tool.input));
      const handler = this.registry.get(call.name);
      if (!handler) throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Outil pas encore disponible');
      const args = call.args as Record<string, unknown>;
      const meta = tool.definition._meta;
      const action = meta['bj.techma/requiresMandate'];

      return await this.db.transaction({ userRef: call.context.userRef }, async (tx) => {
        let keyHash: string | undefined;
        if (action) {
          const { traceId: _trace, ...context } = call.context;
          const reservation = await this.idempotency.reserve(
            tx,
            { actor: call.actor, method: 'tools/call', route: `/mcp#${call.name}`, key: call.idempotencyKey },
            { name: call.name, args, context },
          );
          if (reservation.kind === 'replay') return reservation.response as Record<string, unknown>;
          keyHash = reservation.keyHash;
        }

        let mandateChecked = false;
        const emitted: EventData[] = [];
        const invocation: ToolInvocation = {
          context: call.context,
          trace: call.trace,
          tx,
          requireMandate: async (procedureId) => {
            const mandate = await this.mandates.requireForTool(tx, call.context, meta['bj.techma/scopes'], procedureId);
            mandateChecked = true;
            mandateId = mandate.id;
            return mandate;
          },
          emit: (data) => emitted.push(data),
        };

        const output = await handler.run(args, invocation);
        if (action && !mandateChecked) throw new Error(`L'outil d'action ${call.name} n'a pas contrôlé le mandat`);
        if (!tool.output(output)) {
          this.logger.error(`Sortie non conforme pour ${call.name} : ${errorsText(tool.output)}`);
          throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Réponse amont non conforme');
        }

        for (const data of emitted) await this.outbox.enqueue(tx, data, call.trace.traceId);
        await this.outbox.enqueue(tx, { kind: 'tool.called', toolName: call.name, conversationId: call.context.conversationId, outcome: 'success', code: 'OK' }, call.trace.traceId);
        await this.audit.record(tx, this.entry(call, 'success', 'OK', mandateId, output));
        if (keyHash) await this.idempotency.complete(tx, keyHash, output);
        return output as Record<string, unknown>;
      });
    } catch (error) {
      await this.recordFailure(call, toProblem(error).code, mandateId);
      throw error;
    }
  }

  private async recordFailure(call: ToolCall, code: string, mandateId: string | undefined): Promise<void> {
    try {
      await this.db.transaction({ userRef: call.context.userRef }, async (tx) => {
        // Un appel refusé pour débit n'est pas relayé au Backend : pas d'amplification.
        if (code !== 'RATE_LIMITED') {
          await this.outbox.enqueue(tx, { kind: 'tool.called', toolName: call.name, conversationId: call.context.conversationId, outcome: 'error', code }, call.trace.traceId);
        }
        await this.audit.record(tx, this.entry(call, 'error', code, mandateId));
      });
    } catch (error) {
      // Base indisponible : l'échec reste visible dans les journaux du processus.
      this.logger.error(`Échec non journalisé (${call.name}, ${code}, trace ${call.trace.traceId}) : ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private entry(call: ToolCall, outcome: 'success' | 'error', code: string, mandateId?: string, output?: unknown): AuditEntry {
    const args = (call.args ?? {}) as Record<string, unknown>;
    const produced = (output as { id?: unknown } | undefined)?.id;
    const requestId = typeof args.requestId === 'string' ? args.requestId : typeof produced === 'string' && produced.startsWith('req_') ? produced : undefined;
    return {
      traceId: call.trace.traceId,
      actor: call.actor,
      action: call.name.slice(0, 64),
      outcome,
      code,
      conversationId: call.context.conversationId,
      userRef: call.context.userRef,
      mandateId: mandateId ?? call.context.mandateId,
      requestId,
    };
  }
}
