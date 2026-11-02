import { Problem, type Schemas } from "./domain.js";

type AdministrationList = Schemas["AdministrationList"];
type ProcedurePage = Schemas["ProcedurePage"];

export class XroadClient {
  constructor(
    private baseUrl: string,
    private token: () => Promise<string>,
  ) {}
  private async get(path: string, headers: Record<string, string> = {}) {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        redirect: "error",
        headers: {
          Authorization: "Bearer " + (await this.token()),
          ...headers,
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "X-Road indisponible.");
    }
    if (!response.ok)
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "X-Road indisponible.");
    return response.json();
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
    let response: Response;
    try {
      response = await fetch(
        new URL(
          `/v1/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}`,
          this.baseUrl,
        ),
        {
          redirect: "error",
          headers: {
            Authorization: "Bearer " + (await this.token()),
            "X-Applicant-Ref": userRef,
          },
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "X-Road indisponible.");
    }
    if (response.status === 404)
      throw new Problem(404, "NOT_FOUND", "Document introuvable.");
    if (!response.ok)
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "X-Road indisponible.");
    return {
      mimeType: response.headers.get("content-type") ?? "application/pdf",
      bytes: Buffer.from(await response.arrayBuffer()),
    };
  }
}
