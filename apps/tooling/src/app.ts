import 'reflect-metadata';
import { Global, Module, RequestMethod, type DynamicModule, type INestApplication, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AuditModule } from './audit/audit-log.js';
import { AuthModule } from './auth/auth.module.js';
import { ProblemFilter } from './common/problem.js';
import { securityHeaders } from './common/security-headers.js';
import { TraceMiddleware } from './common/trace.js';
import { TOOLING_CONFIG, type ToolingConfig } from './config.js';
import { DatabaseModule } from './database/database.module.js';
import { EventsModule } from './events/events.module.js';
import { GatewayModule } from './gateway/mcp.controller.js';
import { ToolRegistryModule } from './gateway/tool-registry.js';
import { HealthController } from './health.controller.js';
import { IdempotencyModule } from './idempotency/idempotency.js';
import { MandatesModule } from './mandates/mandates.module.js';
import { ProceduresModule } from './procedures/procedures.module.js';
import { RequestsModule } from './requests/requests.module.js';

@Global()
@Module({})
class ConfigModule {
  static forRoot(config: ToolingConfig): DynamicModule {
    return { module: ConfigModule, providers: [{ provide: TOOLING_CONFIG, useValue: config }], exports: [TOOLING_CONFIG] };
  }
}

@Module({})
class AppModule implements NestModule {
  static forRoot(config: ToolingConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        DatabaseModule,
        AuthModule,
        AuditModule,
        IdempotencyModule,
        EventsModule,
        ToolRegistryModule,
        MandatesModule,
        ProceduresModule,
        RequestsModule,
        GatewayModule,
      ],
      controllers: [HealthController],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TraceMiddleware)
      .exclude({ path: 'health', method: RequestMethod.GET }, { path: 'ready', method: RequestMethod.GET })
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}

export async function createApp(config: ToolingConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: config.production ? ['error', 'warn', 'log'] : ['error', 'warn'],
  });
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.useBodyParser('json', { limit: '100kb' });
  app.use(securityHeaders);
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  return app;
}
