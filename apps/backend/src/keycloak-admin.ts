import { randomBytes } from "node:crypto";
import { Problem } from "./domain.js";
import { approvedMcpUrl } from "./domain.js";

export type CreatedOfficialAccount = { subject: string; temporaryPassword: string };

export class KeycloakAdmin {
  constructor(
    private issuer: string,
    private token: () => Promise<string>,
  ) {}
  async createUser(input: { email: string; displayName: string }): Promise<CreatedOfficialAccount> {
    const temporaryPassword = randomBytes(12).toString("base64url") + "Aa1!";
    const endpoint = new URL("admin/realms/techma/users", this.issuer.endsWith("/") ? this.issuer : this.issuer + "/").href;
    if (!approvedMcpUrl(endpoint, new Set([endpoint])))
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Annuaire d’identité indisponible.");
    const names = input.displayName.trim().split(/\s+/);
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer " + (await this.token()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: input.email,
        email: input.email,
        enabled: true,
        emailVerified: true,
        firstName: names[0] ?? input.displayName,
        lastName: names.slice(1).join(" ") || input.displayName,
        credentials: [{ type: "password", value: temporaryPassword, temporary: true }],
        realmRoles: ["official"],
      }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => {
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Annuaire d’identité indisponible.");
    });
    if (response.status === 409) throw new Problem(409, "CONFLICT", "Compte déjà existant.");
    if (!response.ok) throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Création du compte refusée.");
    const location = response.headers.get("location") ?? "";
    const subject = location.split("/").at(-1);
    if (!subject) throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Identifiant Keycloak absent.");
    return { subject, temporaryPassword };
  }
  async disableUser(subject: string): Promise<void> {
    const endpoint = new URL(
      "admin/realms/techma/users/" + encodeURIComponent(subject),
      this.issuer.endsWith("/") ? this.issuer : this.issuer + "/",
    ).href;
    if (!approvedMcpUrl(endpoint, new Set([endpoint])))
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Annuaire d’identité indisponible.");
    const headers = {
      Authorization: "Bearer " + (await this.token()),
      "Content-Type": "application/json",
    };
    const disabled = await fetch(endpoint, {
      method: "PUT",
      redirect: "error",
      headers,
      body: JSON.stringify({ enabled: false }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => undefined);
    if (disabled?.ok) return;
    const removed = await fetch(endpoint, {
      method: "DELETE",
      redirect: "error",
      headers: { Authorization: headers.Authorization },
      signal: AbortSignal.timeout(15000),
    }).catch(() => undefined);
    if (!removed?.ok) throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Compensation Keycloak impossible.");
  }
}
