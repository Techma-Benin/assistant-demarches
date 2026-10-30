import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AppConfig } from '../config/config.js';
import { safeEqual, subjectKeyFor } from '../common/crypto.js';
import { describeError } from '../common/errors.js';
import { line, loggerFor } from '../common/log.js';
import { ProblemException } from '../common/problem.js';
import type { RawBodyRequest } from '../common/raw-body.js';
import { newTraceparent } from '../common/trace.js';
import { APP_CONFIG, INBOUND_QUEUE } from '../tokens.js';
import type { InboundQueue } from './inbound-queue.js';
import { extractMessages } from './payload.js';
import { verifyMetaSignature } from './signature.js';

export const WEBHOOK_BODY_LIMIT = 256 * 1024;

@Controller('webhooks/meta')
export class MetaWebhookController {
  private readonly logger = loggerFor('MetaWebhook');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(INBOUND_QUEUE) private readonly queue: InboundQueue,
  ) {}

  /** Vérification d’abonnement Meta : renvoie le challenge en text/plain. */
  @Get()
  verify(@Req() req: RawBodyRequest, @Res() res: Response): void {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const mode = params.get('hub.mode');
    const token = params.get('hub.verify_token');
    const challenge = params.get('hub.challenge');
    if (mode === 'subscribe' && token !== null && challenge !== null && safeEqual(token, this.config.meta.verifyToken)) {
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    throw new ProblemException(403, 'FORBIDDEN', 'Vérification refusée');
  }

  @Post()
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest): Record<string, never> {
    const raw = req.rawBody ?? Buffer.alloc(0);
    // Signature vérifiée sur les octets bruts, avant tout parsing.
    if (!verifyMetaSignature(this.config.meta.appSecret, raw, req.headers['x-hub-signature-256'])) {
      throw new ProblemException(401, 'UNAUTHORIZED', 'Signature invalide');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new ProblemException(400, 'INVALID_REQUEST', 'JSON invalide');
    }
    for (const message of extractMessages(payload)) {
      try {
        this.queue.enqueue({
          subjectKey: subjectKeyFor(this.config.subjectHmacKey, message.from),
          message,
          traceparent: newTraceparent(),
        });
      } catch (error) {
        this.logger.error(line('webhook.enqueue_failed', { wamid: message.id, error: describeError(error) }));
      }
    }
    return {};
  }
}
