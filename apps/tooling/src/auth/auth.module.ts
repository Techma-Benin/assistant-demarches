import { Global, Module } from '@nestjs/common';
import { ProofVerifier } from './proof-verifier.js';
import { ServiceAuth } from './service-auth.js';
import { ServiceTokens } from './service-tokens.js';

@Global()
@Module({ providers: [ServiceAuth, ServiceTokens, ProofVerifier], exports: [ServiceAuth, ServiceTokens, ProofVerifier] })
export class AuthModule {}
