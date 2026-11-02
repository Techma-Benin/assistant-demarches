'use client';

import { Badge, Button, InlineAlert } from '@techma/ui';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { describeError, operatorApi, type OperatorStatus } from '@/lib/operator/api';
import { PageHeader, formatDate } from '../ui';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4 md:p-5">
      <h2 className="mb-3 font-display text-xl font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

const Reachability = ({ ok }: { ok: boolean }) => <Badge tone={ok ? 'trust' : 'danger'}>{ok ? 'Joignable' : 'Injoignable'}</Badge>;

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
        title="État des connexions"
        description="Modèle actif, serveurs MCP et administrations connectées."
        actions={
          <Button variant="outline" disabled={loading} onClick={() => void load()}>
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
        <div className="flex flex-col gap-4">
          <Section title="Modèle">
            {status.model ? (
              <p className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">{status.model.label}</span>
                <Reachability ok={status.model.reachable} />
              </p>
            ) : (
              <p className="text-ink-muted">Aucun modèle actif.</p>
            )}
          </Section>
          <Section title="Serveurs MCP">
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
          <Section title="Administrations">
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
                      <Badge tone={connected ? 'trust' : 'warning'}>{connected ? 'Connectée' : 'Non connectée'}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
