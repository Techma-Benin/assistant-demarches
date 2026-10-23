import { Body, Controller, Global, HttpCode, Inject, Logger, Module, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuditLog } from '../audit/audit-log.js';
import { ProofVerifier, type Challenge } from '../auth/proof-verifier.js';
import { ServiceAuth } from '../auth/service-auth.js';
import { newId } from '../common/ids.js';
import { ProblemError, toProblem } from '../common/problem.js';
import { traceOf, type TraceContext } from '../common/trace.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { domainValidator } from '../contracts.js';
import { Database } from '../database/database.js';
import { Idempotency } from '../idempotency/idempotency.js';
import { MandatesRepository, type Mandate } from './mandates.repository.js';

const validateGrant = domainValidator('MandateGrant');
const MANDATE_ID = /^mdt_[0-9A-HJKMNP-TV-Z]{26}$/;
const CLOCK_SKEW_MS = 30_000;

interface MandateGrant {
  challenge: Challenge;
  acceptedAt: string;
  evidenceRef: string;
}

/**
 * Contrôle des mandats hors agent (tooling-internal.openapi.json). Seul le client
 * backend-mandates y accède ; accorder un mandat n'est jamais un outil MCP.
 */
@Controller('internal/v1/mandates')
export class MandatesController {
  private readonly logger = new Logger(MandatesController.name);

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    @Inject(Database) private readonly db: Database,
    private readonly auth: ServiceAuth,
    private readonly proofs: ProofVerifier,
    private readonly mandates: MandatesRepository,
    private readonly idempotency: Idempotency,
    private readonly audit: AuditLog,
  ) {}

  @Post()
  @HttpCode(201)
  async grant(@Req() req: Request, @Body() body: unknown): Promise<Mandate> {
    const principal = await this.auth.require(req.headers.authorization, 'backend-mandates', 'mandates:grant');
    const trace = traceOf(req);
    if (!validateGrant(body)) throw new ProblemError(400, 'INVALID_REQUEST', 'MandateGrant invalide');
    const grant = body as MandateGrant;
    const { challenge } = grant;
    return this.audited(trace, principal.client, 'mandate.grant', challenge, async () =>
      this.db.transaction('system', async (tx) => {
        const reservation = await this.idempotency.reserve(tx, { actor: principal.client, method: 'POST', route: '/internal/v1/mandates', key: this.key(req) }, grant);
        if (reservation.kind === 'replay') return reservation.response as Mandate;

        const now = Date.now();
        if (!challenge.scopes.length || new Set(challenge.scopes).size !== challenge.scopes.length) throw new ProblemError(400, 'INVALID_REQUEST', 'Scopes vides ou répétés');
        if (Date.parse(challenge.expiresAt) <= now) throw new ProblemError(403, 'MANDATE_EXPIRED', 'Challenge expiré');
        const acceptedAt = Date.parse(grant.acceptedAt);
        if (acceptedAt > now + CLOCK_SKEW_MS || acceptedAt > Date.parse(challenge.expiresAt)) throw new ProblemError(400, 'INVALID_REQUEST', "Date d'accord incohérente");
        await this.proofs.verify(challenge);

        const mandate = await this.mandates.insert(tx, {
          id: newId('mdt'),
          challengeId: challenge.id,
          conversationId: challenge.conversationId,
          userRef: challenge.userRef,
          procedureId: challenge.procedureId,
          scopes: challenge.scopes,
          evidenceRef: grant.evidenceRef,
          acceptedAt: grant.acceptedAt,
          expiresAt: new Date(now + this.config.mandateTtlMs).toISOString(),
        });
        if (!mandate) throw new ProblemError(403, 'FORBIDDEN', 'Preuve de consentement déjà utilisée');
        await this.audit.record(tx, { traceId: trace.traceId, actor: principal.client, action: 'mandate.grant', outcome: 'success', code: 'OK', conversationId: mandate.conversationId, userRef: mandate.userRef, mandateId: mandate.id });
        await this.idempotency.complete(tx, reservation.keyHash, mandate);
        return mandate;
      }),
    );
  }

  @Post(':mandateId/revoke')
  @HttpCode(200)
  async revoke(@Req() req: Request, @Param('mandateId') mandateId: string): Promise<Mandate> {
    const principal = await this.auth.require(req.headers.authorization, 'backend-mandates', 'mandates:grant');
    const trace = traceOf(req);
    if (!MANDATE_ID.test(mandateId)) throw new ProblemError(404, 'NOT_FOUND', 'Mandat inconnu');
    return this.audited(trace, principal.client, 'mandate.revoke', { mandateId }, async () =>
      this.db.transaction('system', async (tx) => {
        const reservation = await this.idempotency.reserve(tx, { actor: principal.client, method: 'POST', route: `/internal/v1/mandates/${mandateId}/revoke`, key: this.key(req) }, { mandateId });
        if (reservation.kind === 'replay') return reservation.response as Mandate;
        const mandate = await this.mandates.revoke(tx, mandateId);
        if (!mandate) throw new ProblemError(404, 'NOT_FOUND', 'Mandat inconnu');
        await this.audit.record(tx, { traceId: trace.traceId, actor: principal.client, action: 'mandate.revoke', outcome: 'success', code: 'OK', conversationId: mandate.conversationId, userRef: mandate.userRef, mandateId: mandate.id });
        await this.idempotency.complete(tx, reservation.keyHash, mandate);
        return mandate;
      }),
    );
  }

  private key(req: Request): string | undefined {
    const value = req.headers['idempotency-key'];
    return typeof value === 'string' ? value : undefined;
  }

  /** Les refus sont journalisés à part : la transaction de l'opération a été annulée. */
  private async audited<T>(trace: TraceContext, actor: string, action: string, subject: { conversationId?: string; userRef?: string; mandateId?: string }, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const { code } = toProblem(error);
      await this.db
        .transaction('system', (tx) =>
          this.audit.record(tx, { traceId: trace.traceId, actor, action, outcome: 'error', code, conversationId: subject.conversationId, userRef: subject.userRef, mandateId: subject.mandateId }),
        )
        .catch((failure) => this.logger.error(`Refus non journalisé (${action}, ${code}) : ${failure instanceof Error ? failure.message : String(failure)}`));
      throw error;
    }
  }
}

@Global()
@Module({ controllers: [MandatesController], providers: [MandatesRepository], exports: [MandatesRepository] })
export class MandatesModule {}
