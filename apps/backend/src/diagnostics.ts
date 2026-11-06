import { Problem } from "./domain.js";

type Metadata = Record<string, string | number | boolean | undefined>;
export class DiagnosticProblem extends Problem {
  constructor(detail: string, public readonly diagnostic: Metadata) {
    super(503, "UPSTREAM_UNAVAILABLE", detail);
  }
}
const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : undefined;
// A provider "param" is a structural path such as `tools[0].function.parameters`: it names a field, never carries user text.
const parameterPath = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:\-[\]]{1,128}$/.test(value) ? value : undefined;
/** Never serialize arbitrary errors, request bodies, response bodies, headers or credentials. */
export function describeError(error: unknown): Metadata {
  const value = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | undefined;
  return {
    errorName: identifier(value?.name) ?? "Error",
    code: error instanceof Problem ? error.code : "UPSTREAM_UNAVAILABLE",
    detail: error instanceof Problem ? error.message : "Erreur interne ; consulter errorName et causeCode.",
    causeCode: identifier(value?.cause?.code) ?? identifier(value?.code),
    ...(error instanceof DiagnosticProblem ? error.diagnostic : {}),
  };
}
export function logFailure(event: string, error: unknown, context: Metadata = {}) {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", event, ...context, ...describeError(error) }));
}

/** Classify provider explanations without logging text that might echo user data. */
export function providerReason(status: number, message: unknown): string {
  const text = typeof message === "string" ? message.toLowerCase() : "";
  if (/access denied/.test(text) && /network/.test(text)) return "provider_network_access_denied";
  if (status === 401) return "provider_authentication_failed";
  if (status === 403) return "provider_access_forbidden";
  if (status === 429) return "provider_rate_limit_or_quota";
  if (status >= 500) return "provider_service_unavailable";
  if (/tools/.test(text) && /empty|non-empty/.test(text)) return "provider_empty_tools_rejected";
  return "provider_request_rejected";
}

/**
 * Finer reading of a refused request, kept apart from `reason` because the fallbacks key on `reason`.
 * Only a fixed label comes out: the provider text itself is never logged.
 */
export function providerHint(status: number, message: unknown, code?: unknown): string | undefined {
  const text = typeof message === "string" ? message.toLowerCase() : "";
  const upstreamCode = typeof code === "string" ? code.toLowerCase() : "";
  if (upstreamCode === "model_not_found" || (status === 404 && /model/.test(text))) return "model_not_found_or_not_allowed";
  if (upstreamCode === "context_length_exceeded" || /context (length|window)|maximum context|too many tokens/.test(text)) return "context_too_long";
  if (/^unsupported_(parameter|value)$/.test(upstreamCode) || /unsupported (parameter|value)|not supported (with|for|by) this model/.test(text)) return "unsupported_parameter_for_model";
  if (/tool|function/.test(text) && /not supported|unsupported|not allowed/.test(text)) return "tools_not_supported_for_model_or_endpoint";
  if (/api.?key|incorrect key|invalid key/.test(text)) return "api_key_problem";
  return undefined;
}
export function safeProviderIdentifier(value: unknown) { return identifier(value); }
export function safeProviderParameter(value: unknown) { return parameterPath(value); }
