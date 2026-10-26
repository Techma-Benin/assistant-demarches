import { Module } from '@nestjs/common';
import { APP_CONFIG, C1_CLIENT, SUBJECT_TOKEN_PROVIDER } from '../tokens.js';
import type { AppConfig } from '../config/config.js';
import { HttpC1Client } from './c1-client.js';
import { DevSubjectTokenProvider, ExchangeSubjectTokenProvider } from './subject-token.js';

@Module({
  providers: [
    {
      provide: SUBJECT_TOKEN_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.isProduction
          ? new ExchangeSubjectTokenProvider()
          : new DevSubjectTokenProvider(config.mockUserToken, config.backendUrl),
    },
    { provide: C1_CLIENT, inject: [APP_CONFIG], useFactory: (config: AppConfig) => new HttpC1Client(config.backendUrl) },
  ],
  exports: [SUBJECT_TOKEN_PROVIDER, C1_CLIENT],
})
export class BackendModule {}
