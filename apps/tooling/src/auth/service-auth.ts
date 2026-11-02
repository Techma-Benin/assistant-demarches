import { Inject, Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ProblemError } from '../common/problem.js';
import { BACKEND_CLIENT, TOOLING_AUDIENCE, TOOLING_CONFIG, type ToolingConfig } from '../config.js';

export type InboundScope = 'tools:call' | 'mandates:grant';

export interface Principal {
  client: string;
  scopes: ReadonlySet<string>;
}

@Injectable()
export class ServiceAuth {
  private readonly logger = new Logger(ServiceAuth.name);
  private readonly jwks: JWTVerifyGetKey;

  constructor(@Inject(TOOLING_CONFIG) private readonly config: ToolingConfig) {
    this.jwks = createRemoteJWKSet(config.oidc.jwksUrl, { timeoutDuration: 5000, cooldownDuration: 30000 });
  }

  async require(authorization: string | undefined, scope: InboundScope): Promise<Principal> {
    const principal = await this.authenticate(authorization);
    if (principal.client !== BACKEND_CLIENT) throw new ProblemError(401, 'UNAUTHORIZED', 'Identité de service non acceptée');
    if (!principal.scopes.has(scope)) throw new ProblemError(403, 'FORBIDDEN', 'Scope requis absent');
    return principal;
  }

  private async authenticate(authorization: string | undefined): Promise<Principal> {
    const token = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(authorization ?? '')?.[1];
    if (!token) throw new ProblemError(401, 'UNAUTHORIZED', 'Jeton Bearer requis');
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.oidc.issuer,
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
      if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) throw new ProblemError(401, 'UNAUTHORIZED', 'Jeton invalide');
      this.logger.error(`JWKS indisponible : ${error instanceof Error ? error.message : String(error)}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', "Fournisseur d'identité indisponible");
    }
  }
}
