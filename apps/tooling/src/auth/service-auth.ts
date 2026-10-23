import { Inject, Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ProblemError } from '../common/problem.js';
import { TOOLING_AUDIENCE, TOOLING_CONFIG, type ToolingConfig } from '../config.js';

export type InboundClient = 'backend-agent' | 'backend-mandates';

export interface Principal {
  client: string;
  scopes: ReadonlySet<string>;
}

/** Jetons publics de la suite partagée ; acceptés seulement en mode mock-tokens (local, hors production). */
const MOCK_PRINCIPALS: Record<string, Principal> = {
  'mock-agent': { client: 'backend-agent', scopes: new Set(['tools:call']) },
  'mock-backend-control': { client: 'backend-mandates', scopes: new Set(['mandates:grant']) },
};

/** Authentifie les clients de service entrants : JWT RS256 vérifié contre le JWKS du realm. */
@Injectable()
export class ServiceAuth {
  private readonly logger = new Logger(ServiceAuth.name);
  private readonly jwks?: JWTVerifyGetKey;

  constructor(@Inject(TOOLING_CONFIG) private readonly config: ToolingConfig) {
    if (config.jwt) this.jwks = createRemoteJWKSet(config.jwt.jwksUrl, { timeoutDuration: 5000, cooldownDuration: 30000 });
  }

  /**
   * 401 si l'identité est invalide ou n'est pas celle attendue sur cette route
   * (comportement de la suite partagée), 403 si le scope manque.
   */
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
      // Keycloak place l'identifiant du client de service dans azp.
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
