import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Pool, PoolClient } from "pg";

type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;

function material(env: NodeJS.ProcessEnv = process.env): Buffer {
  const configured = env.CONFIGURATION_SECRETS_KEY?.trim();
  if (configured) return createHash("sha256").update(configured).digest();
  const file = env.SIGNING_KEY_FILE;
  if (file && existsSync(file)) return createHash("sha256").update(readFileSync(file)).digest();
  return createHash("sha256").update("techma-local-configuration-secrets").digest();
}

export function encryptSecret(plaintext: string, env: NodeJS.ProcessEnv = process.env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", material(env), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
}

export function decryptSecret(ciphertext: string, env: NodeJS.ProcessEnv = process.env): string {
  const [version, payload] = ciphertext.split(":");
  if (version !== "v1" || !payload) throw new Error("Secret illisible.");
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 29) throw new Error("Secret illisible.");
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", material(env), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export async function upsertModelSecret(
  db: Db,
  administrationId: string,
  modelId: string,
  plaintext: string,
): Promise<void> {
  await db.query(
    "INSERT INTO backend_secrets(administration_id,resource,resource_id,ciphertext) VALUES($1,'models',$2,$3) ON CONFLICT (administration_id,resource,resource_id) DO UPDATE SET ciphertext=excluded.ciphertext, updated_at=now()",
    [administrationId, modelId, encryptSecret(plaintext)],
  );
}

export async function deleteModelSecret(db: Db, administrationId: string, modelId: string): Promise<void> {
  await db.query(
    "DELETE FROM backend_secrets WHERE administration_id=$1 AND resource='models' AND resource_id=$2",
    [administrationId, modelId],
  );
}

export async function readModelSecret(
  db: Db,
  administrationId: string,
  modelId: string,
): Promise<string | undefined> {
  const row = (
    await db.query(
      "SELECT ciphertext FROM backend_secrets WHERE administration_id=$1 AND resource='models' AND resource_id=$2",
      [administrationId, modelId],
    )
  ).rows[0] as { ciphertext?: string } | undefined;
  if (!row?.ciphertext) return undefined;
  try {
    return decryptSecret(row.ciphertext);
  } catch {
    return undefined;
  }
}
