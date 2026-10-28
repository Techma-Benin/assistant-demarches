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

export class Files {
  constructor(
    private pool: Pool,
    private storage: ObjectStorage,
  ) {}
  async upload(userRef: string, data: Buffer, mime: string, key: string) {
    if (!Buffer.isBuffer(data) || !data.length)
      throw new Problem(400, "INVALID_REQUEST", "Fichier vide.");
    const file: Schemas["File"] = {
      id: identifier("fil"),
      mimeType: mime as Schemas["File"]["mimeType"],
      sizeBytes: data.length,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
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
    let written = false;
    try {
      return await idempotent(
        this.pool,
        [userRef, "POST", "/v1/files"],
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
