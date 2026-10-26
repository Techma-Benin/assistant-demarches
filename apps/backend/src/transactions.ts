import type { Pool, PoolClient } from "pg";
import { Problem, canonical, fingerprint } from "./domain.js";

export async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export function idempotencyKey(value?: string): string {
  if (!value || value.length < 8 || value.length > 128)
    throw new Problem(
      400,
      "INVALID_REQUEST",
      "Idempotency-Key requis (8 à 128 caractères).",
    );
  return value;
}
export async function idempotent<T>(
  pool: Pool,
  scope: unknown,
  key: string,
  body: unknown,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const encoded = canonical(scope),
    digest = fingerprint(body);
  return transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      canonical([encoded, key]),
    ]);
    const previous = (
      await client.query(
        "SELECT fingerprint,response FROM backend_idempotency WHERE scope=$1 AND key=$2 AND expires_at>now()",
        [encoded, key],
      )
    ).rows[0];
    if (previous) {
      if (previous.fingerprint !== digest)
        throw new Problem(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Clé réutilisée pour un contenu différent.",
        );
      return previous.response as T;
    }
    const result = await work(client);
    await client.query(
      "INSERT INTO backend_idempotency(scope,key,fingerprint,response) VALUES($1,$2,$3,$4) ON CONFLICT(scope,key) DO UPDATE SET fingerprint=excluded.fingerprint,response=excluded.response,expires_at=now()+interval '24 hours'",
      [encoded, key, digest, JSON.stringify(result)],
    );
    return result;
  });
}
