import { Body, Controller, Global, HttpCode, Inject, Logger, Module, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuditLog } from '../audit/audit-log.js';
import { ProofVerifier, type Challenge } from '../auth/proof-verifier.js';
import { RequestGuard } from '../auth/request-guard.js';
import { newId } from '../common/ids.js';
import { ProblemError, toProblem } from '../common/problem.js';
import { traceOf, type TraceContext } from '../common/trace.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { domainValidator } from '../contracts.js';
import { Database, type Tx } from '../database/database.js';
import { Outbox } from '../events/outbox.js';
import { Idempotency } from '../idempotency/idempotency.js';
import { MandatesRepository, type Mandate } from './mandates.repository.js';

const validateGrant = domainValidator('MandateGrant');
const MANDATE_ID = /^mdt_[0-9A-HJKMNP-TV-Z]{26}$/;
const USER_REF = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;
const CLOCK_SKEW_MS = 30_000;

interface MandateGrant {
  challenge: Challenge;
  acceptedAt: string;
  evidenceRef: string;
}

@Controller('internal/v1/mandates')
export class MandatesController {
  private readonly logger = new Logger(MandatesController.name);

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    @Inject(Database) private readonly db: Database,
    private readonly guard: RequestGuard,
    private readonly proofs: ProofVerifier,
    private readonly mandates: MandatesRepository,
    private readonly idempotency: Idempotency,
    private readonly audit: AuditLog,
    private readonly outbox: Outbox,
  ) {}

  @Post()
  @HttpCode(201)
  async grant(@Req() req: Request, @Body() body: unknown): Promise<Mandate> {
    const principal = await this.guard.authorize(req, 'mandates:grant');
    const trace = traceOf(req);
    if (!validateGrant(body)) throw new ProblemError(400, 'INVALID_REQUEST', 'MandateGrant invalide');
    const grant = body as MandateGrant;
    const { challenge } = grant;
    return this.audited(trace, principal.client, 'mandate.grant', challenge, async () =>
      this.db.transaction('system', async (tx) => {
        const reservation = await this.idempotency.reserve(tx, { actor: principal.client, method: 'POST', route: '/internal/v1/mandates', key: this.key(req) }, grant);
        if (reservation.kind === 'replay') return this.replayed(tx, trace, principal.client, 'mandate.grant', reservation.response as Mandate);

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
        await this.outbox.enqueue(tx, { kind: 'mandate.granted', mandate }, trace.traceId);
        await this.audit.record(tx, { traceId: trace.traceId, actor: principal.client, action: 'mandate.grant', outcome: 'success', code: 'OK', conversationId: mandate.conversationId, userRef: mandate.userRef, mandateId: mandate.id });
        await this.idempotency.complete(tx, reservation.keyHash, mandate);
        return mandate;
      }),
    );
  }

  @Post(':mandateId/revoke')
  @HttpCode(200)
  async revoke(@Req() req: Request, @Param('mandateId') mandateId: string): Promise<Mandate> {
    const principal = await this.guard.authorize(req, 'mandates:grant');
    const trace = traceOf(req);
    const owner = req.headers['x-user-ref'];
    if (typeof owner !== 'string' || !USER_REF.test(owner)) throw new ProblemError(400, 'INVALID_REQUEST', 'X-User-Ref requis');
    if (!MANDATE_ID.test(mandateId)) throw new ProblemError(404, 'NOT_FOUND', 'Mandat inconnu');
    return this.audited(trace, principal.client, 'mandate.revoke', { mandateId }, async () =>
      this.db.transaction('system', async (tx) => {
        const reservation = await this.idempotency.reserve(tx, { actor: principal.client, method: 'POST', route: `/internal/v1/mandates/${mandateId}/revoke`, key: this.key(req) }, { mandateId, owner });
        if (reservation.kind === 'replay') return this.replayed(tx, trace, principal.client, 'mandate.revoke', reservation.response as Mandate);
        const mandate = await this.mandates.revoke(tx, mandateId, owner);
        if (!mandate) throw new ProblemError(404, 'NOT_FOUND', 'Mandat inconnu');
        await this.outbox.enqueue(tx, { kind: 'mandate.revoked', mandate }, trace.traceId);
        await this.audit.record(tx, { traceId: trace.traceId, actor: principal.client, action: 'mandate.revoke', outcome: 'success', code: 'OK', conversationId: mandate.conversationId, userRef: mandate.userRef, mandateId: mandate.id });
        await this.idempotency.complete(tx, reservation.keyHash, mandate);
        return mandate;
      }),
    );
  }

  private async replayed(tx: Tx, trace: TraceContext, actor: string, action: string, mandate: Mandate): Promise<Mandate> {
    await this.audit.record(tx, { traceId: trace.traceId, actor, action, outcome: 'success', code: 'REPLAY', conversationId: mandate.conversationId, userRef: mandate.userRef, mandateId: mandate.id });
    return mandate;
  }

  private key(req: Request): string | undefined {
    const value = req.headers['idempotency-key'];
    return typeof value === 'string' ? value : undefined;
  }

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
