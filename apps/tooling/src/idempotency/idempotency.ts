import { Global, Injectable, Module } from '@nestjs/common';
import { canonicalJson, sha256 } from '../common/ids.js';
import { ProblemError } from '../common/problem.js';
import type { Tx } from '../database/database.js';

export type Reservation = { kind: 'fresh'; keyHash: string } | { kind: 'replay'; response: unknown };

const KEY = /^[\x21-\x7e]{8,128}$/;

/**
 * Idempotence partagée entre processus et répliques. La réservation est une insertion
 * dans la transaction métier : un doublon concurrent attend la validation de la première,
 * puis rejoue sa réponse. Une erreur annule la transaction et libère la clé, sans effet.
 */
@Injectable()
export class Idempotency {
  /** Portée = identité authentifiée + méthode + route + clé ; contenu comparé par empreinte. */
  async reserve(tx: Tx, scope: { actor: string; method: string; route: string; key: string | undefined }, payload: unknown): Promise<Reservation> {
    if (typeof scope.key !== 'string' || !KEY.test(scope.key)) {
      throw new ProblemError(400, 'INVALID_REQUEST', 'Idempotency-Key de 8 à 128 caractères requis');
    }
    const keyHash = sha256(canonicalJson([scope.actor, scope.method, scope.route, scope.key]));
    const digest = sha256(canonicalJson(payload));
    const inserted = await tx.query('insert into idempotency_keys (key_hash, request_digest) values ($1, $2) on conflict do nothing returning key_hash', [keyHash, digest]);
    if (inserted.length) return { kind: 'fresh', keyHash };

    const [existing] = await tx.query<{ request_digest: string; response: unknown }>('select request_digest, response from idempotency_keys where key_hash = $1', [keyHash]);
    if (!existing || existing.request_digest !== digest) {
      throw new ProblemError(409, 'IDEMPOTENCY_CONFLICT', 'Clé déjà utilisée avec un autre contenu');
    }
    return { kind: 'replay', response: existing.response };
  }

  async complete(tx: Tx, keyHash: string, response: unknown): Promise<void> {
    await tx.query('update idempotency_keys set response = $2::jsonb where key_hash = $1', [keyHash, JSON.stringify(response)]);
  }
}

@Global()
@Module({ providers: [Idempotency], exports: [Idempotency] })
export class IdempotencyModule {}
