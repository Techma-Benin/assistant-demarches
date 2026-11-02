import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate } from "../dist/apps/backend/src/database.js";
import { Files, matchesDeclaredType } from "../dist/apps/backend/src/files.js";
import { LocalStorage } from "../dist/apps/backend/src/storage.js";
import { validate } from "../dist/apps/backend/src/domain.js";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const samples = { "application/pdf": PDF, "image/jpeg": JPEG, "image/png": PNG };

test("declared type must match the leading bytes (pdf, jpeg, png); audio keeps its own validation", async (t) => {
  assert.equal(matchesDeclaredType(PDF, "application/pdf"), true);
  assert.equal(matchesDeclaredType(Buffer.from("%PDF"), "application/pdf"), false, "%PDF- needs the dash");
  assert.equal(matchesDeclaredType(Buffer.from([0xff, 0xd8]), "image/jpeg"), false, "truncated signature");
  assert.equal(matchesDeclaredType(Buffer.from("anything"), "audio/ogg"), true, "audio is not checked here");

  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => { await pool.end(); await pg.close(); });
  await migrate(pool);
  const files = new Files(pool, new LocalStorage(mkdtempSync(join(tmpdir(), "techma-upload-"))));
  let n = 0;
  const key = () => "upload-content-" + String(++n).padStart(4, "0");

  for (const [mime, bytes] of Object.entries(samples)) {
    const stored = await files.upload("usr_a", bytes, mime, key());
    validate("File", stored);
    assert.equal(stored.mimeType, mime);
  }
  for (const [declared, declaredBytes] of Object.entries(samples))
    for (const [actual, bytes] of Object.entries(samples)) {
      if (declared === actual) continue;
      await assert.rejects(
        () => files.upload("usr_a", bytes, declared, key()),
        (error) => error.status === 415 && error.code === "UNSUPPORTED_MEDIA_TYPE",
        `${actual} bytes declared as ${declared}`,
      );
    }
  await assert.rejects(() => files.upload("usr_a", Buffer.from("MZ not a document"), "application/pdf", key()), (error) => error.status === 415);
  await assert.rejects(() => files.upload("usr_a", Buffer.from("<html>"), "image/png", key()), (error) => error.status === 415);
  await assert.rejects(() => files.storeAvatar("off_x", PDF, "image/jpeg"), (error) => error.status === 415);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM backend_files")).rows[0].n, 3, "refused uploads are not stored");
  // Audio is accepted at upload exactly as before; transcription validates its header later.
  const audio = await files.upload("usr_a", Buffer.from("OggS fake"), "audio/ogg", key());
  assert.equal(audio.mimeType, "audio/ogg");
});
