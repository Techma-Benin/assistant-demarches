import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { XroadClient } from "../dist/apps/backend/src/xroad.js";

test("home reads assisted procedures first and truncates suggestions to 8", async (t) => {
  const paths = [];
  const upstream = http.createServer((req, res) => {
    paths.push(req.url);
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url.startsWith("/v1/administrations")) {
      res.end(JSON.stringify({ items: [] }));
      return;
    }
    const assisted = req.url.includes("assisted=true");
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: (assisted ? "A" : "L") + String(i).padStart(4, "0"),
      title: (assisted ? "Assistée " : "Liste ") + i,
      filing: assisted ? {} : null,
    }));
    res.end(JSON.stringify({ items }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => new Promise((resolve) => { upstream.closeAllConnections(); upstream.close(resolve); }));
  const home = await new XroadClient("http://127.0.0.1:" + upstream.address().port, async () => "token").home();
  assert.ok(paths.includes("/v1/procedures?assisted=true&limit=20"));
  assert.ok(paths.includes("/v1/procedures?limit=20"));
  assert.equal(home.suggestions.length, 8);
  assert.deepEqual(home.suggestions.slice(0, 4).map((item) => item.procedureId), ["A0000", "A0001", "A0002", "A0003"]);
  assert.ok(home.suggestions.slice(0, 4).every((item) => item.assisted));
});
