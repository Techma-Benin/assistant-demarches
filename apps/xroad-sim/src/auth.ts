import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { XROAD_AUDIENCE, type SimConfig } from './config.js';
import { ProblemError } from './problem.js';

export type XroadClient = 'tooling-xroad' | 'backend-xroad';

export interface Principal {
  client: string;
  scopes: ReadonlySet<string>;
}

// Static tokens, accepted only on a local, non-production listener (see config).
const MOCK_PRINCIPALS: Record<string, Principal> = {
  'mock-tooling-xroad': { client: 'tooling-xroad', scopes: new Set(['xroad:apply']) },
  'mock-backend-xroad': { client: 'backend-xroad', scopes: new Set(['xroad:apply', 'xroad:administer']) },
};

export class ServiceAuth {
  private readonly jwks?: JWTVerifyGetKey;

  constructor(private readonly config: SimConfig) {
    if (config.jwt) this.jwks = createRemoteJWKSet(config.jwt.jwksUrl, { timeoutDuration: 5000, cooldownDuration: 30000 });
  }

  async authenticate(authorization: string | undefined): Promise<Principal> {
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
        audience: XROAD_AUDIENCE,
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
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', "Fournisseur d'identité indisponible");
    }
  }
}

export function requireScope(principal: Principal, scope: string, clients: readonly XroadClient[]): void {
  requireAnyScope(principal, [scope], clients);
}

export function requireAnyScope(principal: Principal, scopes: readonly string[], clients: readonly XroadClient[]): void {
  if (!clients.includes(principal.client as XroadClient)) throw new ProblemError(403, 'FORBIDDEN', 'Identité de service non acceptée sur cette route');
  if (!scopes.some((scope) => principal.scopes.has(scope))) throw new ProblemError(403, 'FORBIDDEN', 'Scope requis absent');
}
