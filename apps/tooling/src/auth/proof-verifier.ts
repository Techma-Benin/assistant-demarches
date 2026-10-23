import { Inject, Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ProblemError } from '../common/problem.js';
import { MANDATE_PROOF_AUDIENCE, TOOLING_CONFIG, type ToolingConfig } from '../config.js';

export interface Challenge {
  id: string;
  conversationId: string;
  userRef: string;
  procedureId: string;
  scopes: string[];
  expiresAt: string;
  proofToken: string;
}

/**
 * Vérifie le JWT challenge.proofToken signé par le Backend (CONTRACTS.md §6) et compare
 * chaque claim à l'objet transmis. La preuve seule ne vaut pas consentement : l'appel doit
 * aussi venir du client backend-mandates, et le jti n'est consommable qu'une fois.
 */
@Injectable()
export class ProofVerifier {
  private readonly logger = new Logger(ProofVerifier.name);
  private readonly jwks?: JWTVerifyGetKey;

  constructor(@Inject(TOOLING_CONFIG) private readonly config: ToolingConfig) {
    if (config.jwt) this.jwks = createRemoteJWKSet(config.jwt.proof.jwksUrl, { timeoutDuration: 5000, cooldownDuration: 30000 });
  }

  async verify(challenge: Challenge): Promise<void> {
    // Mode local : les simulations émettent des preuves opaques, non signées.
    if (!this.config.jwt || !this.jwks) return;
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(challenge.proofToken, this.jwks, {
        audience: MANDATE_PROOF_AUDIENCE,
        algorithms: ['RS256'],
        clockTolerance: 30,
        requiredClaims: ['jti', 'sub', 'exp'],
        ...(this.config.jwt.proof.issuer ? { issuer: this.config.jwt.proof.issuer } : {}),
      }));
    } catch (error) {
      if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) throw this.invalid();
      this.logger.error(`JWKS des preuves indisponible : ${error instanceof Error ? error.message : String(error)}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Vérification de preuve momentanément indisponible');
    }
    const scopes = Array.isArray(payload.scopes) ? payload.scopes : [];
    const sameScopes = scopes.length === challenge.scopes.length && challenge.scopes.every((scope) => scopes.includes(scope));
    const matches =
      payload.jti === challenge.id &&
      payload.sub === challenge.userRef &&
      payload.conversationId === challenge.conversationId &&
      payload.procedureId === challenge.procedureId &&
      sameScopes &&
      payload.exp === Math.floor(Date.parse(challenge.expiresAt) / 1000);
    if (!matches) throw this.invalid();
  }

  private invalid(): ProblemError {
    return new ProblemError(403, 'FORBIDDEN', 'Preuve de consentement invalide');
  }
}
