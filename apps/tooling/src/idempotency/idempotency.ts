import { Global, Injectable, Module } from '@nestjs/common';
import { canonicalJson, sha256 } from '../common/ids.js';
import { ProblemError } from '../common/problem.js';
import type { Tx } from '../database/database.js';

export type Reservation = { kind: 'fresh'; keyHash: string } | { kind: 'replay'; response: unknown };

export interface IdempotencyScope {
  actor: string;
  method: string;
  route: string;
  key: string | undefined;
}

export interface IdempotencyKey {
  keyHash: string;
  digest: string;
}

const KEY = /^[\x21-\x7e]{8,128}$/;

@Injectable()
export class Idempotency {
  keyFor(scope: IdempotencyScope, payload: unknown): IdempotencyKey {
    if (typeof scope.key !== 'string' || !KEY.test(scope.key)) {
      throw new ProblemError(400, 'INVALID_REQUEST', 'Idempotency-Key de 8 à 128 caractères requis');
    }
    return { keyHash: sha256(canonicalJson([scope.actor, scope.method, scope.route, scope.key])), digest: sha256(canonicalJson(payload)) };
  }

  async lookup(tx: Tx, key: IdempotencyKey): Promise<{ response: unknown } | undefined> {
    const [existing] = await tx.query<{ request_digest: string; response: unknown }>('select request_digest, response from idempotency_keys where key_hash = $1', [key.keyHash]);
    if (!existing) return undefined;
    if (existing.request_digest !== key.digest) throw new ProblemError(409, 'IDEMPOTENCY_CONFLICT', 'Clé déjà utilisée avec un autre contenu');
    return existing.response === null ? undefined : { response: existing.response };
  }

  async reserve(tx: Tx, scope: IdempotencyScope | IdempotencyKey, payload?: unknown): Promise<Reservation> {
    const key = 'keyHash' in scope ? scope : this.keyFor(scope, payload);
    const inserted = await tx.query('insert into idempotency_keys (key_hash, request_digest) values ($1, $2) on conflict do nothing returning key_hash', [key.keyHash, key.digest]);
    if (inserted.length) return { kind: 'fresh', keyHash: key.keyHash };
    const prior = await this.lookup(tx, key);
    if (!prior) throw new ProblemError(409, 'IDEMPOTENCY_CONFLICT', 'Clé déjà utilisée avec un autre contenu');
    return { kind: 'replay', response: prior.response };
  }

  async complete(tx: Tx, keyHash: string, response: unknown): Promise<void> {
    await tx.query('update idempotency_keys set response = $2::jsonb where key_hash = $1', [keyHash, JSON.stringify(response)]);
  }
}

@Global()
@Module({ providers: [Idempotency], exports: [Idempotency] })
export class IdempotencyModule {}
