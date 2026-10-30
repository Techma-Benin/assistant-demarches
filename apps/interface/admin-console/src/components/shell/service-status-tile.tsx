import { cn } from '@techma/ui';
import type { ServiceStatus } from '@/lib/service-status';
import { formatInteger } from '@/lib/format';

function Line({ ok, children }: { ok: boolean | null; children: string }) {
  return (
    <li className="flex items-center gap-2 text-[13px] font-semibold text-ink">
      <span
        aria-hidden="true"
        className={cn('size-2 shrink-0 rounded-full', ok === null ? 'bg-line-strong' : ok ? 'bg-trust' : 'bg-flag-red')}
      />
      {children}
    </li>
  );
}

/** « État du service », derived from the admin APIs only. */
export function ServiceStatusTile({
  status,
  showMcp = true,
  showModel = true,
}: {
  status: ServiceStatus | null;
  showMcp?: boolean;
  showModel?: boolean;
}) {
  const mcp = status?.mcpConnections ?? null;
  const model = status?.activeModel ?? null;
  return (
    <section aria-label="État du service" className="rounded-card border border-line-subtle bg-surface p-3.5">
      <h2 className="mb-2 text-xs font-bold tracking-[0.04em] text-ink-muted uppercase">État du service</h2>
      <ul className="flex flex-col gap-2" aria-busy={status === null}>
        <Line ok={status === null ? null : status.backendReachable}>
          {status === null ? 'Backend : vérification…' : status.backendReachable ? 'Backend joignable' : 'Backend injoignable'}
        </Line>
        {showMcp ? (
          <Line ok={mcp === null ? null : mcp > 0}>
            {mcp === null ? 'Connexions MCP : inconnu' : `${formatInteger(mcp)} connexion${mcp > 1 ? 's' : ''} MCP`}
          </Line>
        ) : null}
        {showModel ? (
          <Line ok={model === null ? null : model !== ''}>
            {model === null ? 'Modèle : inconnu' : model === '' ? 'Aucun modèle actif' : model}
          </Line>
        ) : null}
      </ul>
    </section>
  );
}
