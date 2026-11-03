import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { XROAD_AUDIENCE, type SimConfig } from './config.js';
import { ProblemError } from './problem.js';

const CLIENTS = new Set(['tooling', 'backend']);

export interface Principal {
  client: string;
  scopes: ReadonlySet<string>;
}

export class ServiceAuth {
  private readonly jwks: JWTVerifyGetKey;

  constructor(private readonly config: SimConfig) {
    this.jwks = createRemoteJWKSet(config.jwksUrl, { timeoutDuration: 5000, cooldownDuration: 30000 });
  }

  async authenticate(authorization: string | undefined): Promise<Principal> {
    const token = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(authorization ?? '')?.[1];
    if (!token) throw new ProblemError(401, 'UNAUTHORIZED', 'Jeton Bearer requis');

    let client: unknown;
    let scope: unknown;
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: XROAD_AUDIENCE,
        algorithms: ['RS256'],
        clockTolerance: 30,
        requiredClaims: ['exp'],
      });
      client = payload.azp;
      scope = payload.scope;
    } catch (error) {
      if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) {
        throw new ProblemError(401, 'UNAUTHORIZED', 'Jeton invalide');
      }
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', "Fournisseur d'identité indisponible");
    }
    if (typeof client !== 'string' || !CLIENTS.has(client)) throw new ProblemError(403, 'FORBIDDEN', 'Identité de service non acceptée');
    return { client, scopes: new Set(typeof scope === 'string' ? scope.split(' ').filter(Boolean) : []) };
  }
}

export function requireScope(principal: Principal, ...anyOf: string[]): void {
  if (!anyOf.some((scope) => principal.scopes.has(scope))) throw new ProblemError(403, 'FORBIDDEN', 'Scope requis absent');
}
