import type { INestApplication } from '@nestjs/common';
import { ProblemFilter, sendProblem } from './common/problem.js';
import { rawBodyMiddleware } from './common/raw-body.js';
import type { AppConfig } from './config/config.js';
import { CALLBACK_BODY_LIMIT } from './callback/callback.controller.js';
import { WEBHOOK_BODY_LIMIT } from './webhook/meta-webhook.controller.js';
import { MAX_MEDIA_BYTES } from './meta/meta.js';

/**
 * Configuration HTTP commune à `main.ts` et aux tests : l’application doit être créée avec
 * `bodyParser: false` ; les corps bruts sont lus ici avec une limite par route.
 */
export function configureApp(app: INestApplication, config: AppConfig): void {
  app.useGlobalFilters(new ProblemFilter());
  app.use(
    '/webhooks/meta',
    rawBodyMiddleware(WEBHOOK_BODY_LIMIT, (req, res) =>
      sendProblem(res, 413, 'FILE_TOO_LARGE', 'Corps trop volumineux', req.headers['traceparent']),
    ),
  );
  app.use(
    '/v1/callbacks/events',
    rawBodyMiddleware(CALLBACK_BODY_LIMIT, (req, res) =>
      sendProblem(res, 400, 'INVALID_REQUEST', 'Corps trop volumineux', req.headers['traceparent']),
    ),
  );
  if (!config.isProduction) {
    app.use(
      '/dev/media',
      rawBodyMiddleware(MAX_MEDIA_BYTES + 1024, (req, res) =>
        sendProblem(res, 413, 'FILE_TOO_LARGE', 'Corps trop volumineux', req.headers['traceparent']),
      ),
    );
  }
  app.enableShutdownHooks();
}
