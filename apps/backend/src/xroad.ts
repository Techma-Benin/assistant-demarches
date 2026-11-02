import { Problem, type Schemas } from "./domain.js";

type AdministrationList = Schemas["AdministrationList"];
type ProcedurePage = Schemas["ProcedurePage"];

const RELAYED_STATUS = new Set([400, 401, 403, 404, 409, 413, 415, 429, 503]);

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
    const code = typeof body?.code === "string" ? body.code : undefined;
    const detail = typeof body?.detail === "string" ? body.detail : undefined;
    if (status === 404) return new Problem(404, code ?? "NOT_FOUND", detail ?? "Ressource introuvable.");
    if (status === 403) return new Problem(403, code ?? "FORBIDDEN", detail ?? "Droit insuffisant.");
    if (status === 401) return new Problem(401, code ?? "UNAUTHORIZED", detail ?? "Identité X-Road refusée.");
    if (status === 409) return new Problem(409, code ?? "CONFLICT", detail ?? "Conflit d’état.");
    if (status === 400) return new Problem(400, code ?? "INVALID_REQUEST", detail ?? "Requête refusée par le X-Road.");
    if (status === 413) return new Problem(413, code ?? "FILE_TOO_LARGE", detail ?? "Fichier trop volumineux.");
    if (status === 415) return new Problem(415, code ?? "UNSUPPORTED_MEDIA_TYPE", detail ?? "Type de média non pris en charge.");
    if (status === 503 || !RELAYED_STATUS.has(status))
      return new Problem(503, code ?? "UPSTREAM_UNAVAILABLE", detail ?? "X-Road indisponible.");
    return new Problem(status, code ?? "UPSTREAM_UNAVAILABLE", detail ?? "X-Road indisponible.");
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
