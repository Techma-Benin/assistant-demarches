import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import SwaggerParser from "@apidevtools/swagger-parser";
import { describeSpecification, examples, operationHelp } from "../dist/apps/backend/src/documentation-guide.js";
import { attachDocumentation } from "../dist/apps/backend/src/documentation.js";
import { validate } from "../dist/apps/backend/src/domain.js";
const names = ["conversation"];
const served = ["conversation", "admin", "operator", "backend-internal", "tooling-internal"];
test("every conversation contract operation has a documentation-guide entry", () => {
  const spec = JSON.parse(readFileSync(new URL("../../../contracts/v2/conversation.openapi.json", import.meta.url)));
  const missing = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      if (!operationHelp[operation.operationId]) missing.push(`${method.toUpperCase()} ${path} (${operation.operationId})`);
    }
  }
  assert.deepEqual(missing, [], missing.length ? `Missing endpoint documentation: ${missing.join(", ")}` : undefined);
});
test("Swagger documents all backend operations with schema-valid examples and preserves the wire contracts", async () => {
  const documented = new Set();
  for (const name of names) {
    const original = JSON.parse(readFileSync(new URL(`../../../contracts/v2/${name}.openapi.json`, import.meta.url)));
    const before = structuredClone(original);
    const spec = describeSpecification(name, original);
    assert.deepEqual(original, before);
    await SwaggerParser.validate(structuredClone(spec));
    assert.match(spec.info.description, /\/docs\/guide/);
    for (const [path, methods] of Object.entries(before.paths)) for (const [method, operation] of Object.entries(methods)) {
      const enriched = spec.paths[path][method];
      documented.add(operation.operationId);
      for (const section of ["Prérequis", "Comment tester", "Résultat attendu", "Suite du parcours", "Erreurs à vérifier"]) assert.ok(enriched.description.includes(section), operation.operationId);
      assert.deepEqual(enriched.security, operation.security);
      assert.deepEqual(Object.keys(enriched.responses), Object.keys(operation.responses));
      assert.deepEqual(enriched.parameters.map(p => [p.name, p.required, p.schema]), operation.parameters.map(p => [p.name, p.required, p.schema]));
      for (const parameter of enriched.parameters) {
        if (parameter.example === undefined) continue;
        if (parameter.schema.$ref) validate(parameter.schema.$ref.split("/").at(-1), parameter.example);
        if (parameter.schema.pattern) assert.match(parameter.example, new RegExp(parameter.schema.pattern));
      }
      for (const [mime, body] of Object.entries(operation.requestBody?.content ?? {})) {
        const enrichedBody = enriched.requestBody.content[mime];
        assert.deepEqual(enrichedBody.schema, body.schema);
        if (mime === "application/json") {
          assert.ok(enrichedBody.example, operation.operationId);
          validate(body.schema.$ref.split("/").at(-1), enrichedBody.example);
        }
      }
    }
  }
  assert.deepEqual([...documented].sort(), Object.keys(operationHelp).sort());
  for (const [name, value] of Object.entries(examples)) validate(name, value);
});
test("Swagger serves its selector, guide, enriched contracts and local scripts", async () => {
  const app = express();
  attachDocumentation(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await (await fetch(base + "/docs")).text();
    assert.match(page, /SwaggerUIStandalonePreset/);
    assert.match(page, /layout:"StandaloneLayout"/);
    assert.match(page, /url:"\/docs\/openapi\/conversation.json"/);
    for (const asset of ["swagger-ui.css", "swagger-ui-bundle.js", "swagger-ui-standalone-preset.js"]) assert.equal((await fetch(`${base}/docs/assets/${asset}`)).status, 200);
    for (const name of served) {
      const response = await fetch(`${base}/docs/openapi/${name}.json`);
      assert.equal(response.status, 200);
      const spec = await response.json();
      assert.ok(spec.info?.description);
    }
    const conversation = await (await fetch(base + "/docs/openapi/conversation.json")).json();
    assert.ok(conversation.info.description.includes("Authorize"));
    const guide = await fetch(base + "/docs/guide");
    assert.equal(guide.status, 200);
    assert.match(await guide.text(), /Scénario 5/);
    assert.equal((await fetch(base + "/docs/openapi/missing.json")).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
