import pg from 'pg';
import { ProblemError } from './problem.js';

export interface Tx {
  query<R = Record<string, any>>(sql: string, params?: unknown[]): Promise<R[]>;
}

export interface Database {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const RETRYABLE = new Set(['40001', '40P01']);
const UNAVAILABLE = /^(08|57P0)/;

function unavailable(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string') return UNAVAILABLE.test(code);
  return error instanceof Error && /ECONNREFUSED|ECONNRESET|ETIMEDOUT|Connection terminated|timeout exceeded/i.test(error.message);
}

export class PgDatabase implements Database {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
    this.pool.on('error', (error) => console.error(`Connexion inactive perdue : ${error.message}`));
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.once(fn);
      } catch (error) {
        const code = (error as { code?: unknown })?.code;
        if (typeof code === 'string' && RETRYABLE.has(code) && attempt < 3) continue;
        if (unavailable(error)) {
          console.error(`Base indisponible : ${error instanceof Error ? error.message : String(error)}`);
          throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Stockage momentanément indisponible');
        }
        throw error;
      }
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async once<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let destroy = false;
    try {
      await client.query('begin');
      const result = await fn({ query: async (sql, params) => (await client.query(sql, params as unknown[])).rows });
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

const SCHEMA = [
  `create table if not exists xroad_uploads (
    id text primary key,
    applicant_ref text not null,
    mime_type text not null,
    size_bytes integer not null,
    content bytea not null,
    expires_at timestamptz not null
  )`,
  `create table if not exists xroad_cases (
    id text primary key,
    request_id text not null unique,
    administration_id text not null,
    applicant_ref text not null,
    status text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    body jsonb not null
  )`,
  'create index if not exists xroad_cases_administration on xroad_cases (administration_id, status)',
  'create index if not exists xroad_cases_applicant on xroad_cases (applicant_ref)',
  `create table if not exists xroad_documents (
    id text primary key,
    case_id text not null references xroad_cases (id),
    content bytea not null
  )`,
  `create table if not exists xroad_officials (
    id text primary key,
    subject text not null unique,
    email text not null unique,
    administration_id text,
    role text not null,
    body jsonb not null
  )`,
  `create table if not exists xroad_activity (
    seq bigserial primary key,
    case_id text not null,
    administration_id text not null,
    body jsonb not null
  )`,
  'create index if not exists xroad_activity_case on xroad_activity (case_id)',
  `create table if not exists xroad_sequences (
    key text primary key,
    value integer not null
  )`,
  `create table if not exists xroad_replies (
    scope text primary key,
    fingerprint text not null,
    status integer not null,
    body jsonb not null,
    created_at timestamptz not null
  )`,
];

export async function migrate(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    for (const statement of SCHEMA) await tx.query(statement);
  });
}
