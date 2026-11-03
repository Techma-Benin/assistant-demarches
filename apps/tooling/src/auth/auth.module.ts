import { Global, Module } from '@nestjs/common';
import { ProofVerifier } from './proof-verifier.js';
import { RateLimiter } from './rate-limiter.js';
import { RequestGuard } from './request-guard.js';
import { ServiceAuth } from './service-auth.js';
import { ServiceTokens } from './service-tokens.js';

const providers = [ServiceAuth, ServiceTokens, ProofVerifier, RateLimiter, RequestGuard];

@Global()
@Module({ providers, exports: providers })
export class AuthModule {}
