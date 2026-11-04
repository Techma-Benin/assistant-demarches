'use client';

import { Badge, IconButton, InlineAlert, Tooltip, cn } from '@techma/ui';
import { List, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { describeError, operatorApi, type McpServer } from '@/lib/operator/api';
import { formatDate } from '../ui';

export function ConnectionRow({
  server,
  busy,
  onOpenTools,
  onEdit,
  onDelete,
  onDiscoverDone,
  notify,
}: {
  server: McpServer;
  busy: boolean;
  onOpenTools: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDiscoverDone: () => void;
  notify: (message: string) => void;
}) {
  const [discoveredAt, setDiscoveredAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);

  const loadMeta = useCallback(async (signal?: AbortSignal) => {
    try {
      const list = await operatorApi.listTools(server.id, signal);
      setDiscoveredAt(list.discoveredAt);
    } catch {
      if (!signal?.aborted) setDiscoveredAt(null);
    }
  }, [server.id]);

  useEffect(() => {
    const controller = new AbortController();
    void loadMeta(controller.signal);
    return () => controller.abort();
  }, [loadMeta]);

  async function discover() {
    setError(null);
    setDiscovering(true);
    try {
      const list = await operatorApi.discover(server.id);
      setDiscoveredAt(list.discoveredAt);
      onDiscoverDone();
      notify(`${list.items.length} outil${list.items.length > 1 ? 's' : ''} découvert${list.items.length > 1 ? 's' : ''} sur « ${server.name} ».`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setDiscovering(false);
    }
  }

  const headingId = `connection-${server.id}`;

  return (
    <li className="flex flex-col gap-2">
      <div
        className={cn(
          'ui-rise flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-line bg-surface p-4 md:px-5',
        )}
      >
        <button
          type="button"
          className="min-w-0 flex-1 basis-48 cursor-pointer rounded-field text-left outline-none focus-visible:ring-2 focus-visible:ring-trust"
          aria-labelledby={headingId}
          onClick={onOpenTools}
        >
          <h2 id={headingId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[17px] leading-tight font-bold break-words">
            {server.name}
            {server.enabled ? null : <Badge>Désactivé</Badge>}
          </h2>
          <p className="mt-0.5 font-mono text-[13px] break-all text-ink-muted">{server.url}</p>
          {discoveredAt ? (
            <p className="mt-1 text-xs text-ink-muted">Dernière découverte : {formatDate(discoveredAt)}</p>
          ) : null}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <Tooltip label="Actualiser les outils">
            <IconButton
              label={`Actualiser les outils de ${server.name}`}
              disabled={discovering}
              className="hover:bg-sunken"
              onClick={() => void discover()}
            >
              <RefreshCw aria-hidden="true" className={cn('size-[18px]', discovering && 'animate-spin motion-reduce:animate-none')} />
            </IconButton>
          </Tooltip>
          <Tooltip label="Outils">
            <IconButton label={`Outils de ${server.name}`} onClick={onOpenTools}>
              <List aria-hidden="true" className="size-[18px]" />
            </IconButton>
          </Tooltip>
          <Tooltip label="Modifier">
            <IconButton label={`Modifier ${server.name}`} onClick={onEdit}>
              <Pencil aria-hidden="true" className="size-[18px]" />
            </IconButton>
          </Tooltip>
          <Tooltip label="Supprimer">
            <IconButton
              label={`Supprimer ${server.name}`}
              disabled={busy}
              className="hover:bg-danger-soft hover:text-danger"
              onClick={onDelete}
            >
              <Trash2 aria-hidden="true" className="size-[18px]" />
            </IconButton>
          </Tooltip>
        </div>
      </div>
      {error ? <InlineAlert>{error}</InlineAlert> : null}
    </li>
  );
}
