import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProblemError } from '../common/problem.js';
import { TOOLING_CONFIG, type OutboundClient, type ToolingConfig } from '../config.js';

interface CachedToken {
  value: string;
  expiresAt: number;
}

const REFRESH_MARGIN_MS = 30_000;

@Injectable()
export class ServiceTokens {
  private readonly logger = new Logger(ServiceTokens.name);
  private readonly cache = new Map<OutboundClient, CachedToken>();
  private readonly pending = new Map<OutboundClient, Promise<string>>();

  constructor(@Inject(TOOLING_CONFIG) private readonly config: ToolingConfig) {}

  async get(client: OutboundClient): Promise<string> {
    if (!this.config.jwt) return `mock-${client}`;
    const credentials = this.config.jwt.clients[client];
    if ('token' in credentials) return credentials.token;
    const cached = this.cache.get(client);
    if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.value;
    let pending = this.pending.get(client);
    if (!pending) {
      pending = this.fetchToken(client).finally(() => this.pending.delete(client));
      this.pending.set(client, pending);
    }
    return pending;
  }

  invalidate(client: OutboundClient): void {
    this.cache.delete(client);
  }

  private async fetchToken(client: OutboundClient): Promise<string> {
    const credentials = this.config.jwt!.clients[client];
    if ('token' in credentials) return credentials.token;
    let res: Response;
    try {
      res = await fetch(credentials.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: credentials.id,
          client_secret: credentials.secret,
          scope: credentials.scope,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      this.logger.error(`Fournisseur OIDC injoignable pour ${client} : ${error instanceof Error ? error.message : String(error)}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', "Fournisseur d'identité indisponible");
    }
    const body = (await res.json().catch(() => undefined)) as { access_token?: unknown; expires_in?: unknown } | undefined;
    if (!res.ok || typeof body?.access_token !== 'string' || typeof body.expires_in !== 'number') {
      this.logger.error(`Jeton refusé pour ${client} : HTTP ${res.status}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', "Fournisseur d'identité indisponible");
    }
    this.cache.set(client, { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 });
    return body.access_token;
  }
}
