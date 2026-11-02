import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { HttpMandateControl } from "../dist/apps/backend/src/tooling.js";

const tp = "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01";

test("HttpMandateControl.revoke sends X-User-Ref", async (t) => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    seen.push({ url: req.url, userRef: req.headers["x-user-ref"], key: req.headers["idempotency-key"] });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "mdt_1", status: "revoked" }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => new Promise((resolve) => { upstream.closeAllConnections(); upstream.close(resolve); }));
  const url = "http://127.0.0.1:" + upstream.address().port;
  await new HttpMandateControl(url, async () => "token").revoke("mdt_1", "revoke-key", tp, "usr_aminata");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "/internal/v1/mandates/mdt_1/revoke");
  assert.equal(seen[0].userRef, "usr_aminata");
  assert.equal(seen[0].key, "revoke-key");
});
