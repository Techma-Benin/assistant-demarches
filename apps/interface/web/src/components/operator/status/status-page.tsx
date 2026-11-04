'use client';

import { Button, InlineAlert, cn } from '@techma/ui';
import { CircleAlert, CircleCheck, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { describeError, operatorApi, type OperatorStatus } from '@/lib/operator/api';
import { PageHeader } from '../ui';
import { StatusGraph } from './status-graph';

/** Answer at a glance: what needs attention is the active model and the enabled MCP servers. */
function Summary({ status }: { status: OperatorStatus }) {
  const issues = (status.model?.reachable ? 0 : 1) + status.mcpServers.filter((server) => server.enabled && !server.reachable).length;
  const ok = issues === 0;
  return (
    <p
      role="status"
      className={cn(
        'mb-5 flex items-center gap-3 rounded-card px-5 py-4 text-base font-semibold',
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
    <div className="ui-rise flex min-h-[calc(100dvh-3rem)] flex-col md:min-h-[calc(100dvh-4rem)]">
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
          <StatusGraph status={status} className="min-h-0 flex-1" />
        </>
      )}
    </div>
  );
}
