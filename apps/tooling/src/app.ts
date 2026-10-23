import 'reflect-metadata';
import { Module, RequestMethod, type INestApplication, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ToolingConfig } from './config.js';
import { ProblemFilter } from './common/problem.js';
import { securityHeaders } from './common/security-headers.js';
import { TraceMiddleware } from './common/trace.js';
import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController] })
class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TraceMiddleware)
      .exclude({ path: 'health', method: RequestMethod.GET })
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}

/** Construit l'application sans l'écouter, pour main.ts et pour les tests. */
export async function createApp(config: ToolingConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: config.production ? ['error', 'warn', 'log'] : ['error', 'warn'],
  });
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '100kb' });
  app.use(securityHeaders);
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  return app;
}
