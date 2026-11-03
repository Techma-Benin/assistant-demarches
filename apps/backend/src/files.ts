import type { Pool } from "pg";
import {
  identifier,
  Problem,
  fingerprint,
  validate,
  type Schemas,
} from "./domain.js";
import { idempotent, transaction } from "./transactions.js";
import type { ObjectStorage } from "./storage.js";

const SIGNATURES: Record<string, number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
};
/**
 * Declared type vs. leading bytes for the document and image types of the contract. Audio keeps its own check at
 * transcription time (it needs more than the first bytes), so it is not refused here.
 */
export function matchesDeclaredType(data: Buffer, mime: string): boolean {
  const signature = SIGNATURES[mime];
  if (!signature) return true;
  return data.length >= signature.length && signature.every((byte, index) => data[index] === byte);
}
export const CONTENT_MISMATCH = "Le contenu du fichier ne correspond pas au type déclaré.";

export class Files {
  constructor(
    private pool: Pool,
    private storage: ObjectStorage,
  ) {}
  async upload(userRef: string, data: Buffer, mime: string, key: string, ttlMs = 86400000, namespace = "/v1/files") {
    if (!Buffer.isBuffer(data) || !data.length)
      throw new Problem(400, "INVALID_REQUEST", "Fichier vide.");
    const file: Schemas["File"] = {
      id: identifier("fil"),
      mimeType: mime as Schemas["File"]["mimeType"],
      sizeBytes: data.length,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
    if (data.length > 10485760)
      throw new Problem(413, "FILE_TOO_LARGE", "Fichier supérieur à 10 Mio.");
    try {
      validate("File", file);
    } catch {
      throw new Problem(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Type de fichier non autorisé.",
      );
    }
    if (!matchesDeclaredType(data, mime))
      throw new Problem(415, "UNSUPPORTED_MEDIA_TYPE", CONTENT_MISMATCH);
    let written = false;
    try {
      return await idempotent(
        this.pool,
        [userRef, "POST", namespace],
        key,
        { mime, digest: fingerprint(data.toString("base64")) },
        async (db) => {
          await this.storage.put(file.id, data, mime);
          written = true;
          await db.query(
            "INSERT INTO backend_files(id,user_ref,object_key,body,expires_at) VALUES($1,$2,$1,$3,$4)",
            [file.id, userRef, file, file.expiresAt],
          );
          return file;
        },
      );
    } catch (error) {
      if (written) await this.storage.remove(file.id).catch(() => {});
      throw error;
    }
  }
  async metadata(id: string, userRef: string) {
    const row = (
      await this.pool.query(
        "SELECT body FROM backend_files WHERE id=$1 AND user_ref=$2 AND expires_at>now()",
        [id, userRef],
      )
    ).rows[0];
    if (!row) throw new Problem(404, "NOT_FOUND", "Pièce introuvable.");
    return { file: row.body, userRef };
  }
  async readOwned(id: string, userRef: string): Promise<{ file: Schemas["File"]; bytes: Buffer }> {
    const row = (
      await this.pool.query(
        "SELECT object_key,body FROM backend_files WHERE id=$1 AND user_ref=$2 AND expires_at>now()",
        [id, userRef],
      )
    ).rows[0];
    if (!row) throw new Problem(404, "NOT_FOUND", "Pièce introuvable.");
    const file = row.body as Schemas["File"];
    try {
      validate("File", file);
      if (file.id !== id) throw new Error();
    } catch {
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Métadonnées de la pièce invalides.");
    }
    if (Date.parse(file.expiresAt) <= Date.now())
      throw new Problem(404, "NOT_FOUND", "Pièce introuvable.");
    let bytes: Buffer;
    try {
      bytes = await this.storage.read(row.object_key);
    } catch {
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Lecture de la pièce indisponible.");
    }
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length !== file.sizeBytes || bytes.length > 10485760)
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Contenu de la pièce invalide.");
    if (Date.parse(file.expiresAt) <= Date.now())
      throw new Problem(404, "NOT_FOUND", "Pièce introuvable.");
    return { file, bytes };
  }
  async storeAvatar(officialId: string, data: Buffer, mime: string) {
    const previous = (
      await this.pool.query("SELECT file_id FROM backend_avatars WHERE official_id=$1", [officialId])
    ).rows[0]?.file_id;
    const file = await this.upload(
      "avatar:" + officialId,
      data,
      mime,
      "avatar-" + officialId + "-" + Date.now(),
      10 * 365 * 86400000,
      "/v1/admin/avatars/" + officialId,
    );
    await this.pool.query(
      "INSERT INTO backend_avatars(official_id,file_id) VALUES($1,$2) ON CONFLICT(official_id) DO UPDATE SET file_id=excluded.file_id",
      [officialId, file.id],
    );
    if (previous) await this.storage.remove(previous).catch(() => {});
    return file;
  }
  async readAvatar(officialId: string) {
    const row = (
      await this.pool.query("SELECT file_id FROM backend_avatars WHERE official_id=$1", [officialId])
    ).rows[0];
    if (!row) throw new Problem(404, "NOT_FOUND", "Photo introuvable.");
    return this.readOwned(row.file_id, "avatar:" + officialId);
  }
  async purgeExpired() {
    return transaction(this.pool, async (db) => {
      const rows = (
        await db.query(
          "SELECT id,object_key FROM backend_files WHERE expires_at<=now() LIMIT 100 FOR UPDATE SKIP LOCKED",
        )
      ).rows;
      for (const row of rows) {
        await this.storage.remove(row.object_key);
        await db.query("DELETE FROM backend_files WHERE id=$1", [row.id]);
      }
      return rows.length;
    });
  }
}
