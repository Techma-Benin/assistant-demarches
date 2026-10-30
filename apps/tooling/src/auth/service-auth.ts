import { Inject, Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ProblemError } from '../common/problem.js';
import { TOOLING_AUDIENCE, TOOLING_CONFIG, type ToolingConfig } from '../config.js';

export type InboundClient = 'backend-agent' | 'backend-mandates' | 'backend-admin';

export interface Principal {
  client: string;
  scopes: ReadonlySet<string>;
}

const MOCK_PRINCIPALS: Record<string, Principal> = {
  'mock-agent': { client: 'backend-agent', scopes: new Set(['tools:call']) },
  'mock-backend-control': { client: 'backend-mandates', scopes: new Set(['mandates:grant']) },
  'mock-backend-admin': { client: 'backend-admin', scopes: new Set(['requests:admin']) },
};

@Injectable()
export class ServiceAuth {
  private readonly logger = new Logger(ServiceAuth.name);
  private readonly jwks?: JWTVerifyGetKey;

  constructor(@Inject(TOOLING_CONFIG) private readonly config: ToolingConfig) {
    if (config.jwt) this.jwks = createRemoteJWKSet(config.jwt.jwksUrl, { timeoutDuration: 5000, cooldownDuration: 30000 });
  }

  async require(authorization: string | undefined, client: InboundClient, scope: string): Promise<Principal> {
    const principal = await this.authenticate(authorization);
    if (principal.client !== client) throw new ProblemError(401, 'UNAUTHORIZED', 'Identité de service non acceptée sur cette route');
    if (!principal.scopes.has(scope)) throw new ProblemError(403, 'FORBIDDEN', 'Scope requis absent');
    return principal;
  }

  private async authenticate(authorization: string | undefined): Promise<Principal> {
    const token = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(authorization ?? '')?.[1];
    if (!token) throw new ProblemError(401, 'UNAUTHORIZED', 'Jeton Bearer requis');

    if (!this.config.jwt || !this.jwks) {
      const principal = MOCK_PRINCIPALS[token];
      if (!principal) throw new ProblemError(401, 'UNAUTHORIZED', 'Jeton invalide');
      return principal;
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.jwt.issuer,
        audience: TOOLING_AUDIENCE,
        algorithms: ['RS256'],
        clockTolerance: 30,
        requiredClaims: ['exp'],
      });
      const client = payload.azp ?? payload.client_id;
      if (typeof client !== 'string') throw new ProblemError(401, 'UNAUTHORIZED', 'Jeton invalide');
      const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [];
      return { client, scopes: new Set(scopes) };
    } catch (error) {
      if (error instanceof ProblemError) throw error;
      if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) {
        throw new ProblemError(401, 'UNAUTHORIZED', 'Jeton invalide');
      }
      this.logger.error(`JWKS indisponible : ${error instanceof Error ? error.message : String(error)}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', "Fournisseur d'identité indisponible");
    }
  }
}
