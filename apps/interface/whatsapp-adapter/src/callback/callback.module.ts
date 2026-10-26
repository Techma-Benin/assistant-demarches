import { Module } from '@nestjs/common';
import { APP_CONFIG, CALLBACK_TOKEN_VERIFIER, EVENT_VALIDATOR, OUTBOUND_DISPATCHER } from '../tokens.js';
import type { AppConfig } from '../config/config.js';
import { MetaModule } from '../meta/meta.module.js';
import { CallbackAuthGuard } from './callback-auth.guard.js';
import { DevCallbackTokenVerifier, JoseCallbackTokenVerifier } from './callback-auth.js';
import { CallbackController } from './callback.controller.js';
import { AjvEventValidator } from './event-validator.js';
import { DefaultOutboundDispatcher } from './outbound-dispatcher.js';

@Module({
  imports: [MetaModule],
  controllers: [CallbackController],
  providers: [
    CallbackAuthGuard,
    { provide: OUTBOUND_DISPATCHER, useClass: DefaultOutboundDispatcher },
    {
      provide: EVENT_VALIDATOR,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new AjvEventValidator(config.contractsDir),
    },
    {
      provide: CALLBACK_TOKEN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.isProduction
          ? JoseCallbackTokenVerifier.remote(config.callback.jwksUrl ?? '', config.callback.issuer ?? '')
          : new DevCallbackTokenVerifier(false),
    },
  ],
})
export class CallbackModule {}
