import { Logger } from '@nestjs/common';
import type { PGlite } from '@electric-sql/pglite';
import type { Pool, PoolClient } from 'pg';
import { ProblemError } from '../common/problem.js';

export interface Tx {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]>;
  script(sql: string): Promise<void>;
}

export type DbScope = { userRef: string } | 'system';

export const APP_ROLE = 'tooling_app';

export abstract class Database {
  abstract transaction<T>(scope: DbScope, fn: (tx: Tx) => Promise<T>): Promise<T>;
  abstract ownerTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  abstract ping(): Promise<void>;
  abstract close(): Promise<void>;
}

async function enterScope(tx: Tx, scope: DbScope): Promise<void> {
  await tx.query(`set local role ${APP_ROLE}`);
  await tx.query("select set_config('app.user_ref', $1, true), set_config('app.scope', $2, true)", [
    scope === 'system' ? '' : scope.userRef,
    scope === 'system' ? 'system' : 'user',
  ]);
}

const RETRYABLE = new Set(['40001', '40P01']);
const UNAVAILABLE = /^(08|57P0)/;

function unavailable(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string') return UNAVAILABLE.test(code);
  return error instanceof Error && /ECONNREFUSED|ECONNRESET|ETIMEDOUT|Connection terminated|timeout exceeded/i.test(error.message);
}

export class PgDatabase extends Database {
  private readonly logger = new Logger('Database');

  constructor(private readonly pool: Pool) {
    super();
    pool.on('error', (error: Error) => this.logger.error(`Connexion inactive perdue : ${error.message}`));
  }

  transaction<T>(scope: DbScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(fn, scope);
  }

  ownerTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(fn);
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async run<T>(fn: (tx: Tx) => Promise<T>, scope?: DbScope): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.once(fn, scope);
      } catch (error) {
        const code = (error as { code?: unknown })?.code;
        if (typeof code === 'string' && RETRYABLE.has(code) && attempt < 3) continue;
        if (unavailable(error)) {
          this.logger.error(`Base indisponible : ${error instanceof Error ? error.message : String(error)}`);
          throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Stockage momentanément indisponible');
        }
        throw error;
      }
    }
  }

  private async once<T>(fn: (tx: Tx) => Promise<T>, scope?: DbScope): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    const tx: Tx = {
      query: async (sql, params) => (await client.query(sql, params)).rows,
      script: async (sql) => {
        await client.query(sql);
      },
    };
    let destroy = false;
    try {
      await client.query('begin');
      if (scope) await enterScope(tx, scope);
      const result = await fn(tx);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => {
        destroy = true;
      });
      if (unavailable(error)) destroy = true;
      throw error;
    } finally {
      client.release(destroy);
    }
  }
}

type PgliteTx = Parameters<Parameters<PGlite['transaction']>[0]>[0];

function wrapPglite(raw: PgliteTx): Tx {
  return {
    query: async (sql, params) => (await raw.query(sql, params)).rows as never,
    script: async (sql) => {
      await raw.exec(sql);
    },
  };
}

export class PgliteDatabase extends Database {
  constructor(private readonly db: PGlite) {
    super();
  }

  transaction<T>(scope: DbScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (raw) => {
      const tx = wrapPglite(raw);
      await enterScope(tx, scope);
      return fn(tx);
    });
  }

  ownerTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (raw) => fn(wrapPglite(raw)));
  }

  async ping(): Promise<void> {
    await this.db.query('select 1');
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
