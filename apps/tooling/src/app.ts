import 'reflect-metadata';
import { Module, RequestMethod, type DynamicModule, type INestApplication, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ServiceAuth } from './auth/service-auth.js';
import { ServiceTokens } from './auth/service-tokens.js';
import { TOOLING_CONFIG, type ToolingConfig } from './config.js';
import { ProblemFilter } from './common/problem.js';
import { securityHeaders } from './common/security-headers.js';
import { TraceMiddleware } from './common/trace.js';
import { McpController } from './gateway/mcp.controller.js';
import { ToolExecutor } from './gateway/tool-executor.js';
import { HealthController } from './health.controller.js';
import { BackendResourcesClient } from './resources/backend-resources.client.js';

@Module({})
class AppModule implements NestModule {
  static forRoot(config: ToolingConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, McpController],
      providers: [{ provide: TOOLING_CONFIG, useValue: config }, ServiceAuth, ServiceTokens, BackendResourcesClient, ToolExecutor],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TraceMiddleware)
      .exclude({ path: 'health', method: RequestMethod.GET })
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}

/** Construit l'application sans l'écouter, pour main.ts et pour les tests. */
export async function createApp(config: ToolingConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: config.production ? ['error', 'warn', 'log'] : ['error', 'warn'],
  });
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '100kb' });
  app.use(securityHeaders);
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  return app;
}
