import { Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { canonicalJson, sha256Hex } from '../common/crypto.js';
import { ProblemException } from '../common/problem.js';
import type { RawBodyRequest } from '../common/raw-body.js';
import { parseTraceparent } from '../common/trace.js';
import { DEDUPE_TTL_MS, type DedupeStore } from '../storage/stores.js';
import { DEDUPE_STORE, EVENT_VALIDATOR, OUTBOUND_DISPATCHER } from '../tokens.js';
import { CallbackAuthGuard } from './callback-auth.guard.js';
import type { EventValidator } from './event-validator.js';
import type { OutboundDispatcher } from './outbound-dispatcher.js';

export const CALLBACK_BODY_LIMIT = 1024 * 1024;

@Controller('v1/callbacks')
export class CallbackController {
  constructor(
    @Inject(EVENT_VALIDATOR) private readonly validator: EventValidator,
    @Inject(DEDUPE_STORE) private readonly dedupe: DedupeStore,
    @Inject(OUTBOUND_DISPATCHER) private readonly dispatcher: OutboundDispatcher,
  ) {}

  @Post('events')
  @HttpCode(204)
  @UseGuards(CallbackAuthGuard)
  async receive(@Req() req: RawBodyRequest): Promise<void> {
    if (!parseTraceparent(req.headers['traceparent']))
      throw new ProblemException(400, 'INVALID_REQUEST', 'En-tête traceparent absent ou invalide');
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 128)
      throw new ProblemException(400, 'INVALID_REQUEST', 'Idempotency-Key : 8 à 128 caractères');
    if (!/^application\/(json|[^;]+\+json)\s*(;|$)/i.test(req.headers['content-type'] ?? ''))
      throw new ProblemException(415, 'UNSUPPORTED_MEDIA_TYPE', 'application/json requis');

    let body: unknown;
    try {
      body = JSON.parse((req.rawBody ?? Buffer.alloc(0)).toString('utf8'));
    } catch {
      throw new ProblemException(400, 'INVALID_REQUEST', 'JSON invalide');
    }
    const result = this.validator.validate(body);
    if (!result.ok) throw new ProblemException(400, 'INVALID_REQUEST', result.detail);
    const { event } = result;
    if (event.data.kind !== 'message.sent')
      throw new ProblemException(400, 'INVALID_REQUEST', 'Seul l’événement message.sent est accepté');

    const status = await this.dedupe.check(`evt:${event.id}`, sha256Hex(canonicalJson(body)), DEDUPE_TTL_MS);
    if (status === 'conflict')
      throw new ProblemException(409, 'IDEMPOTENCY_CONFLICT', 'Identifiant d’événement réutilisé avec un autre contenu');
    if (status === 'new') this.dispatcher.dispatch(event);
  }
}
