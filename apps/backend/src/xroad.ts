import { PROBLEM_CODES, Problem, type Schemas } from "./domain.js";

type AdministrationList = Schemas["AdministrationList"];
type ProcedurePage = Schemas["ProcedurePage"];

const MAX_RELAYED_DETAIL = 200;
const UNSAFE_DETAIL = [
  /[\u0000-\u001f\u007f\u2028\u2029]/, // carriage returns, line breaks, control characters
  /[a-z][a-z0-9+.-]*:\/\//i, // URLs
  /\bwww\./i,
  /(?:^|[\s(])(?:localhost|(?:\d{1,3}\.){3}\d{1,3})\b/i, // internal hosts
  /\b[a-z][a-z0-9-]*\.(?:local|internal|svc|lan|corp|cluster)\b/i,
  /[\w.+-]+@[\w-]+\.[\w.-]+/, // e-mail addresses
  /\b[a-z]{2,6}_[0-9A-Z]{20,}\b/, // internal identifiers (usr_…, cas_…, fil_…)
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, // UUIDs
  /\b[0-9a-f]{16,}\b/i, // hashes and long hexadecimal identifiers
  /(?:^|\s)\/[\w.-]+\/[\w./-]+/, // file paths
  /\b(?:SELECT|INSERT|UPDATE|DELETE)\b.+\b(?:FROM|INTO|SET)\b/i,
  /\bat\s+\S+\s*\(/, // stack frames
];

/** Upstream codes outside the published Problem enum never reach the user. */
function relayedCode(code: unknown, fallback: string): string {
  return typeof code === "string" && PROBLEM_CODES.has(code) ? code : fallback;
}
/** The upstream detail is relayed only when it is short, single-line and free of URLs or internal identifiers. */
function relayedDetail(detail: unknown, fallback: string): string {
  if (typeof detail !== "string") return fallback;
  const text = detail.trim();
  if (!text || text.length > MAX_RELAYED_DETAIL || UNSAFE_DETAIL.some((pattern) => pattern.test(text))) return fallback;
  return text;
}

export class XroadClient {
  constructor(
    private baseUrl: string,
    private token: () => Promise<string>,
    private traceparent?: string,
  ) {}
  private async send(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
    binary = false,
  ): Promise<{ status: number; json?: unknown; bytes?: Buffer; mimeType?: string }> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method,
        redirect: "error",
        headers: {
          Authorization: "Bearer " + (await this.token()),
          ...(this.traceparent ? { traceparent: this.traceparent } : {}),
          ...(body !== undefined && !Buffer.isBuffer(body) ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "X-Road indisponible.");
    }
    if (response.status === 204) return { status: 204 };
    if (binary && response.ok)
      return {
        status: response.status,
        mimeType: response.headers.get("content-type") ?? "application/octet-stream",
        bytes: Buffer.from(await response.arrayBuffer()),
      };
    const json = await response.json().catch(() => undefined);
    if (!response.ok) throw this.problem(response.status, json, response.headers.get("retry-after"));
    return { status: response.status, json };
  }
  private problem(status: number, json: unknown, retryAfter?: string | null): Problem {
    if (status === 429) {
      const seconds = /^\d{1,5}$/.test(retryAfter?.trim() ?? "") ? Number(retryAfter!.trim()) : undefined;
      return new Problem(429, "RATE_LIMITED", "Trop de requêtes vers le X-Road ; réessayez dans un instant.", seconds === undefined ? undefined : Math.min(seconds, 3600));
    }
    const body = json as { code?: unknown; detail?: unknown } | undefined;
    const relay = (fallbackCode: string, fallbackDetail: string) =>
      new Problem(status, relayedCode(body?.code, fallbackCode), relayedDetail(body?.detail, fallbackDetail));
    if (status === 404) return relay("NOT_FOUND", "Ressource introuvable.");
    if (status === 403) return relay("FORBIDDEN", "Droit insuffisant.");
    if (status === 401) return relay("UNAUTHORIZED", "Identité X-Road refusée.");
    if (status === 409) return relay("CONFLICT", "Conflit d’état.");
    if (status === 400) return relay("INVALID_REQUEST", "Requête refusée par le X-Road.");
    if (status === 413) return relay("FILE_TOO_LARGE", "Fichier trop volumineux.");
    if (status === 415) return relay("UNSUPPORTED_MEDIA_TYPE", "Type de média non pris en charge.");
    if (status === 503)
      return new Problem(503, relayedCode(body?.code, "UPSTREAM_UNAVAILABLE"), relayedDetail(body?.detail, "X-Road indisponible."));
    return new Problem(503, "UPSTREAM_UNAVAILABLE", "X-Road indisponible.");
  }
  private async get(path: string, headers: Record<string, string> = {}) {
    return (await this.send("GET", path, headers)).json;
  }
  official(subject: string) {
    return { "X-Official-Subject": subject };
  }
  listAdministrations() {
    return this.get("/v1/administrations");
  }
  async home(): Promise<Schemas["HomeContent"]> {
    const [administrations, assisted, listed] = await Promise.all([
      this.get("/v1/administrations") as Promise<AdministrationList>,
      this.get("/v1/procedures?assisted=true&limit=20") as Promise<ProcedurePage>,
      this.get("/v1/procedures?limit=20") as Promise<ProcedurePage>,
    ]);
    const themes = administrations.items
      .filter((item) => item.connection.status === "connected")
      .flatMap((item) =>
        item.themes.map((label) => ({
          label,
          administrationId: item.id,
          administrationName: item.name,
        })),
      );
    const seen = new Set<string>();
    const suggestions: Schemas["HomeContent"]["suggestions"] = [];
    for (const item of [...(assisted.items ?? []), ...(listed.items ?? [])]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      suggestions.push({
        procedureId: item.id,
        title: item.title,
        assisted: item.filing !== null,
      });
    }
    suggestions.sort((left, right) => Number(right.assisted) - Number(left.assisted));
    return { themes, suggestions: suggestions.slice(0, 8) };
  }
  cases(userRef: string, query = "") {
    return this.get("/v1/cases" + query, { "X-Applicant-Ref": userRef });
  }
  case(userRef: string, caseId: string) {
    return this.get("/v1/cases/" + encodeURIComponent(caseId), {
      "X-Applicant-Ref": userRef,
    });
  }
  async document(userRef: string, caseId: string, documentId: string) {
    const file = await this.send(
      "GET",
      `/v1/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}`,
      { "X-Applicant-Ref": userRef },
      undefined,
      true,
    );
    return { mimeType: file.mimeType ?? "application/pdf", bytes: file.bytes! };
  }
  me(subject: string) {
    return this.get("/v1/officials/me", this.official(subject)) as Promise<Schemas["Me"]>;
  }
  updateMe(subject: string, body: Schemas["ProfileUpdate"]) {
    return this.send("PUT", "/v1/officials/me", this.official(subject), body).then((r) => r.json) as Promise<Schemas["Official"]>;
  }
  setAvatar(subject: string, avatarUrl: string) {
    return this.send("PUT", "/v1/officials/me/avatar", this.official(subject), { avatarUrl }).then((r) => r.json) as Promise<Schemas["Official"]>;
  }
  administrations(subject: string, query = "") {
    return this.get("/v1/administrations" + query, this.official(subject));
  }
  listOfficials(subject: string, query = "") {
    return this.get("/v1/officials" + query, this.official(subject));
  }
  createOfficial(subject: string, body: Schemas["OfficialRegistration"], key: string) {
    return this.send("POST", "/v1/officials", { ...this.official(subject), "Idempotency-Key": key }, body).then((r) => r.json) as Promise<Schemas["Official"]>;
  }
  updateOfficial(subject: string, officialId: string, body: Schemas["OfficialUpdate"]) {
    return this.send("PUT", "/v1/officials/" + encodeURIComponent(officialId), this.official(subject), body).then(
      (r) => r.json,
    ) as Promise<Schemas["Official"]>;
  }
  listCases(subject: string, query = "") {
    return this.get("/v1/cases" + query, this.official(subject));
  }
  getCase(subject: string, caseId: string) {
    return this.get("/v1/cases/" + encodeURIComponent(caseId), this.official(subject));
  }
  actOnCase(subject: string, caseId: string, body: Schemas["CaseActionInput"], key: string) {
    return this.send(
      "POST",
      `/v1/cases/${encodeURIComponent(caseId)}/actions`,
      { ...this.official(subject), "Idempotency-Key": key },
      body,
    ).then((r) => r.json) as Promise<Schemas["Case"]>;
  }
  async officialDocument(subject: string, caseId: string, documentId: string) {
    const file = await this.send(
      "GET",
      `/v1/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}`,
      this.official(subject),
      undefined,
      true,
    );
    return { mimeType: file.mimeType ?? "application/pdf", bytes: file.bytes! };
  }
  metrics(subject: string, query = "") {
    return this.get("/v1/metrics" + query, this.official(subject)) as Promise<Schemas["Metrics"]>;
  }
  activity(subject: string, query = "") {
    return this.get("/v1/activity" + query, this.official(subject));
  }
}
