import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { components } from "../../../packages/contracts-ts/src/admin.js";

export type ModelConfig = components["schemas"]["ModelConfig"];
export type ToolConfig = components["schemas"]["ToolConfig"];
export type Schemas = components["schemas"];
export type Config = ModelConfig | ToolConfig | Schemas["Procedure"];
export type Resource = "models" | "tools" | "procedures";
export type Principal = {
  subject: string;
  administrationId: string;
  scopes: Set<string>;
};

export class Problem extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const domain = JSON.parse(
  readFileSync(new URL("./assets/domain.schema.json", import.meta.url), "utf8"),
);
export const ajv = new Ajv2020({ strict: false, allErrors: true });
// ESM/CJS interop differs across the Ajv declaration files.
(addFormats as unknown as (validator: Ajv2020) => void)(ajv);
ajv.addSchema(domain);
export function validate(name: string, value: unknown): void {
  const check = ajv.getSchema(`${domain.$id}#/$defs/${name}`);
  if (!check || !check(value))
    throw new Problem(400, "INVALID_REQUEST", "Corps non conforme au contrat.");
}
export function configId(body: Config): string {
  return "id" in body ? body.id : body.name;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function eventId(): string {
  return identifier("evt");
}
export function identifier(prefix: string): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = BigInt(Date.now());
  let timestamp = "";
  for (let i = 0; i < 10; i++) {
    timestamp = alphabet[Number(time % 32n)] + timestamp;
    time /= 32n;
  }
  return (
    prefix +
    "_" +
    timestamp +
    [...randomBytes(16)].map((byte) => alphabet[byte & 31]).join("")
  );
}
export function approvedMcpUrl(
  value: string,
  allowed: ReadonlySet<string>,
): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
      allowed.has(url.href)
    );
  } catch {
    return false;
  }
}
