'use client';

import { Badge, Button, InlineAlert, cn } from '@techma/ui';
import { Building2, CircleAlert, CircleCheck, CircleX, Cpu, Plug, RefreshCw, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { describeError, operatorApi, type OperatorStatus } from '@/lib/operator/api';
import { PageHeader, formatDate } from '../ui';

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4 md:p-5">
      <h2 className="mb-3 flex items-center gap-2.5 font-display text-xl font-extrabold">
        <Icon aria-hidden="true" className="size-5 text-ink-muted" />
        {title}
      </h2>
      {children}
    </section>
  );
}

const Reachability = ({ ok }: { ok: boolean }) => (
  <Badge
    tone={ok ? 'trust' : 'danger'}
    icon={ok ? <CircleCheck aria-hidden="true" className="size-3.5" /> : <CircleX aria-hidden="true" className="size-3.5" />}
  >
    {ok ? 'Joignable' : 'Injoignable'}
  </Badge>
);

/** Answer at a glance: what needs attention is the active model and the enabled MCP servers. */
function Summary({ status }: { status: OperatorStatus }) {
  const issues = (status.model?.reachable ? 0 : 1) + status.mcpServers.filter((server) => server.enabled && !server.reachable).length;
  const ok = issues === 0;
  return (
    <p
      role="status"
      className={cn(
        'mb-4 flex items-center gap-3 rounded-card px-5 py-4 text-base font-semibold',
        ok ? 'bg-trust-soft text-trust-text' : 'bg-danger-soft text-danger',
      )}
    >
      {ok ? <CircleCheck aria-hidden="true" className="size-6 shrink-0" /> : <CircleAlert aria-hidden="true" className="size-6 shrink-0" />}
      {ok ? 'Tout est opérationnel.' : `${issues} point${issues > 1 ? 's' : ''} à vérifier.`}
    </p>
  );
}

export function StatusPage() {
  const [status, setStatus] = useState<OperatorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    setLoading(true);
    try {
      setStatus(await operatorApi.status(signal));
    } catch (e) {
      if (!signal?.aborted) setError(describeError(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <div className="ui-rise">
      <PageHeader
        title="Statut"
        description="Modèle actif, serveurs MCP et administrations connectées."
        actions={
          <Button
            variant="outline"
            disabled={loading}
            leadingIcon={<RefreshCw aria-hidden="true" className={cn('size-4', loading && 'animate-spin motion-reduce:animate-none')} />}
            onClick={() => void load()}
          >
            Actualiser
          </Button>
        }
      />
      {error ? <InlineAlert className="mb-4">{error}</InlineAlert> : null}
      {!status ? (
        loading ? (
          <p role="status" className="text-sm font-semibold text-ink-muted">
            Chargement…
          </p>
        ) : null
      ) : (
        <>
          <Summary status={status} />
          <div className="flex flex-col gap-4">
            <Section title="Modèle" icon={Cpu}>
              {status.model ? (
                <p className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold">{status.model.label}</span>
                  <Reachability ok={status.model.reachable} />
                </p>
              ) : (
                <p className="text-ink-muted">Aucun modèle actif.</p>
              )}
            </Section>
            <Section title="Serveurs MCP" icon={Plug}>
              {status.mcpServers.length === 0 ? (
                <p className="text-ink-muted">Aucun serveur MCP.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {status.mcpServers.map((server) => (
                    <li key={server.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="font-semibold break-words">
                          {server.name}
                          {server.enabled ? null : <span className="font-normal text-ink-muted"> (désactivé)</span>}
                        </p>
                        <p className="text-sm text-ink-muted">
                          {server.toolCount} outil{server.toolCount > 1 ? 's' : ''}
                          {server.checkedAt ? ` · vérifié le ${formatDate(server.checkedAt)}` : ''}
                        </p>
                      </div>
                      <Reachability ok={server.reachable} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Administrations" icon={Building2}>
              {status.administrations.length === 0 ? (
                <p className="text-ink-muted">Aucune administration.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {status.administrations.map((admin) => {
                    const connected = admin.connection.status === 'connected';
                    return (
                      <li key={admin.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="font-semibold break-words">{admin.name}</p>
                          {connected && admin.connection.since ? (
                            <p className="text-sm text-ink-muted">Depuis le {formatDate(admin.connection.since)}</p>
                          ) : null}
                        </div>
                        <Badge
                          tone={connected ? 'trust' : 'warning'}
                          icon={
                            connected ? (
                              <CircleCheck aria-hidden="true" className="size-3.5" />
                            ) : (
                              <CircleAlert aria-hidden="true" className="size-3.5" />
                            )
                          }
                        >
                          {connected ? 'Connectée' : 'Non connectée'}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
