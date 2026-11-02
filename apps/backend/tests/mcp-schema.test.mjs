import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalog, compileMcpSchema, resolveMcpSchema, sameMcpDefinition } from "../dist/apps/backend/src/tooling.js";

const catalogue = JSON.parse(readFileSync(new URL("../../../contracts/v2/mcp.tools.json", import.meta.url)));
const examples = JSON.parse(readFileSync(new URL("../../../contracts/v2/examples.json", import.meta.url)));

function inlineDefs(schema, defs = catalogue.$defs) {
  return resolveMcpSchema(schema, { ...defs, ...(schema.$defs ?? {}) });
}

test("raw catalogue input and output schemas compile after resolving catalogue $defs", () => {
  assert.ok(catalog.length >= 9);
  for (const tool of catalog) {
    const input = compileMcpSchema(tool.inputSchema);
    assert.equal(typeof input, "function", tool.name + " input");
    if (!tool.outputSchema) continue;
    const output = compileMcpSchema(tool.outputSchema);
    assert.equal(typeof output, "function", tool.name + " output");
    const resolved = resolveMcpSchema(tool.outputSchema);
    if (tool.outputSchema.$ref) assert.equal(resolved.type, "object", tool.name + " output $ref becomes object");
  }
  const get = catalog.find((tool) => tool.name === "procedures.get");
  assert.ok(compileMcpSchema(get.inputSchema)({ procedureId: "PS00373" }));
  assert.ok(!compileMcpSchema(get.inputSchema)({ procedureId: "not-a-procedure" }));
  assert.ok(compileMcpSchema(get.outputSchema)(examples.schemas.Procedure));
});

test("self-contained Tooling schemas match the raw catalogue after normalisation", () => {
  for (const tool of catalog) {
    const listed = {
      name: tool.name,
      description: "inlined by tooling",
      inputSchema: inlineDefs(tool.inputSchema),
      outputSchema: tool.outputSchema ? inlineDefs(tool.outputSchema) : undefined,
      _meta: tool._meta,
    };
    assert.equal(listed.inputSchema.$ref, undefined, tool.name);
    assert.ok(sameMcpDefinition(tool, listed), tool.name);
    compileMcpSchema(listed.inputSchema);
    if (listed.outputSchema) {
      assert.equal(listed.outputSchema.type, "object", tool.name);
      compileMcpSchema(listed.outputSchema);
    }
  }
});
