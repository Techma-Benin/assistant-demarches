import { Module, type DynamicModule } from '@nestjs/common';
import { CallbackModule } from './callback/callback.module.js';
import { ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/config.js';
import { DevModule } from './dev/dev.module.js';
import { HealthController } from './health.controller.js';
import { StorageModule } from './storage/storage.module.js';
import { WebhookModule } from './webhook/webhook.module.js';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        StorageModule,
        WebhookModule,
        CallbackModule,
        // Routes de développement : jamais enregistrées en production.
        ...(config.isProduction ? [] : [DevModule]),
      ],
      controllers: [HealthController],
    };
  }
}
