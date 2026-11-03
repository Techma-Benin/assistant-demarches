import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProblemError } from '../common/problem.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';

const REFRESH_MARGIN_MS = 30_000;

@Injectable()
export class ServiceTokens {
  private readonly logger = new Logger(ServiceTokens.name);
  private cached?: { value: string; expiresAt: number };
  private pending?: Promise<string>;

  constructor(@Inject(TOOLING_CONFIG) private readonly config: ToolingConfig) {}

  async get(): Promise<string> {
    if (this.cached && this.cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return this.cached.value;
    this.pending ??= this.fetchToken().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  private async fetchToken(): Promise<string> {
    const { tokenUrl, clientId, clientSecret } = this.config.oidc;
    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      this.logger.error(`Keycloak injoignable : ${error instanceof Error ? error.message : String(error)}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', "Fournisseur d'identité indisponible");
    }
    const body = (await res.json().catch(() => undefined)) as { access_token?: unknown; expires_in?: unknown } | undefined;
    if (!res.ok || typeof body?.access_token !== 'string' || typeof body.expires_in !== 'number') {
      this.logger.error(`Jeton de service refusé pour ${clientId} : HTTP ${res.status}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', "Fournisseur d'identité indisponible");
    }
    this.cached = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}
