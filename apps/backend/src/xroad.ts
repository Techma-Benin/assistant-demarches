import { Problem, type Schemas } from "./domain.js";

type AdministrationList = Schemas["AdministrationList"];
type ProcedurePage = Schemas["ProcedurePage"];

export class XroadClient {
  constructor(
    private baseUrl: string,
    private token: () => Promise<string>,
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
    if (!response.ok) {
      const code = typeof (json as { code?: unknown })?.code === "string" ? (json as { code: string }).code : undefined;
      if (response.status === 404) throw new Problem(404, code ?? "NOT_FOUND", "Ressource introuvable.");
      if (response.status === 403) throw new Problem(403, code ?? "FORBIDDEN", "Droit insuffisant.");
      if (response.status === 401) throw new Problem(401, code ?? "UNAUTHORIZED", "Identité X-Road refusée.");
      if (response.status === 409) throw new Problem(409, code ?? "CONFLICT", "Conflit d’état.");
      if (response.status === 400) throw new Problem(400, code ?? "INVALID_REQUEST", "Requête refusée par le X-Road.");
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "X-Road indisponible.");
    }
    return { status: response.status, json };
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
    const [administrations, procedures] = await Promise.all([
      this.get("/v1/administrations") as Promise<AdministrationList>,
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
    const suggestions = procedures.items
      .map((item) => ({
        procedureId: item.id,
        title: item.title,
        assisted: item.filing !== null,
      }))
      .sort((left, right) => Number(right.assisted) - Number(left.assisted));
    return { themes, suggestions };
  }
  cases(userRef: string) {
    return this.get("/v1/cases", { "X-Applicant-Ref": userRef });
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
  updateOfficial(subject: string, officialId: string, body: Schemas["OfficialUpdate"], key: string) {
    return this.send(
      "PUT",
      "/v1/officials/" + encodeURIComponent(officialId),
      { ...this.official(subject), "Idempotency-Key": key },
      body,
    ).then((r) => r.json) as Promise<Schemas["Official"]>;
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
