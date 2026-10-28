import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { safeEqual } from '../common/crypto.js';

export class CallbackAuthError extends Error {
  constructor(readonly kind: 'UNAUTHORIZED' | 'FORBIDDEN') {
    super(kind);
    this.name = 'CallbackAuthError';
  }
}

export interface CallbackTokenVerifier {
  /** Lève CallbackAuthError ; ne renvoie jamais le jeton dans un message. */
  verify(token: string): Promise<void>;
}

export const CALLBACK_AUDIENCE = 'whatsapp-adapter';
export const CALLBACK_SCOPE = 'messages:deliver';
export const CALLBACK_AZP = 'backend-delivery';
export const DEV_CALLBACK_TOKEN = 'mock-backend-delivery';

/** Dev : uniquement le jeton statique du mock Backend ; refusé en production. */
export class DevCallbackTokenVerifier implements CallbackTokenVerifier {
  constructor(private readonly isProduction: boolean) {}

  async verify(token: string): Promise<void> {
    if (this.isProduction || !safeEqual(token, DEV_CALLBACK_TOKEN)) throw new CallbackAuthError('UNAUTHORIZED');
  }
}

/** Production : JWT RS256 vérifié contre le JWKS configuré (CONTRACTS.md §3). */
export class JoseCallbackTokenVerifier implements CallbackTokenVerifier {
  constructor(
    private readonly getKey: JWTVerifyGetKey,
    private readonly issuer: string,
  ) {}

  static remote(jwksUrl: string, issuer: string): JoseCallbackTokenVerifier {
    return new JoseCallbackTokenVerifier(createRemoteJWKSet(new URL(jwksUrl)), issuer);
  }

  async verify(token: string): Promise<void> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.getKey, {
        algorithms: ['RS256'],
        issuer: this.issuer,
        audience: CALLBACK_AUDIENCE,
        clockTolerance: 30,
        requiredClaims: ['exp'],
      }));
    } catch {
      throw new CallbackAuthError('UNAUTHORIZED');
    }
    const scopes = typeof payload['scope'] === 'string' ? payload['scope'].split(' ') : [];
    if (!scopes.includes(CALLBACK_SCOPE)) throw new CallbackAuthError('FORBIDDEN');
    if (payload['azp'] !== undefined && payload['azp'] !== CALLBACK_AZP) throw new CallbackAuthError('FORBIDDEN');
  }
}
