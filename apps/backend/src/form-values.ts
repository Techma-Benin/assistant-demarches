/** Values the Interface submits with a form interaction: a JSON object serialised in `value`, nothing else. */
export function parseFormValues(value: string | null | undefined): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function schemaTypes(schema: unknown): string[] {
  const type = schema && typeof schema === "object" ? (schema as { type?: unknown }).type : undefined;
  return (Array.isArray(type) ? type : [type]).filter((item): item is string => typeof item === "string");
}

/** Strings typed in a form become the number or boolean the procedure schema asks for; everything else is untouched. */
export function coerceFieldValue(value: unknown, schema: unknown): unknown {
  if (typeof value !== "string") return value;
  const types = schemaTypes(schema);
  const text = value.trim();
  if ((types.includes("integer") || types.includes("number")) && /^[+-]?\d+(?:[.,]\d+)?$/.test(text)) {
    const parsed = Number(text.replace(",", "."));
    if (Number.isFinite(parsed) && (types.includes("number") || Number.isInteger(parsed))) return parsed;
  }
  if (types.includes("boolean")) {
    const word = text.toLowerCase();
    if (["true", "oui", "yes"].includes(word)) return true;
    if (["false", "non", "no"].includes(word)) return false;
  }
  return value;
}
