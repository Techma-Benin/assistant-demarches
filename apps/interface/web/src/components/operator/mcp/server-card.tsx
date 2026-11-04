'use client';

import {
  Badge,
  Button,
  IconButton,
  InlineAlert,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tooltip,
  cn,
} from '@techma/ui';
import { Radar, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { describeError, operatorApi, type McpServer, type McpTool } from '@/lib/operator/api';
import { ConfirmDialog } from '../confirm-dialog';
import { formatDate } from '../ui';

export function ServerCard({
  server,
  onDeleted,
  notify,
}: {
  server: McpServer;
  onDeleted: (id: string) => void;
  notify: (message: string) => void;
}) {
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [discoveredAt, setDiscoveredAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingTool, setPendingTool] = useState<string | null>(null);

  const loadTools = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const list = await operatorApi.listTools(server.id, signal);
        setTools(list.items);
        setDiscoveredAt(list.discoveredAt);
      } catch (e) {
        if (!signal?.aborted) setError(describeError(e));
      }
    },
    [server.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadTools(controller.signal);
    return () => controller.abort();
  }, [loadTools]);

  async function discover() {
    setError(null);
    setDiscovering(true);
    try {
      const list = await operatorApi.discover(server.id);
      setTools(list.items);
      setDiscoveredAt(list.discoveredAt);
      notify(`${list.items.length} outil${list.items.length > 1 ? 's' : ''} découvert${list.items.length > 1 ? 's' : ''} sur « ${server.name} ».`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setDiscovering(false);
    }
  }

  async function toggle(tool: McpTool, patch: Partial<Pick<McpTool, 'enabled' | 'requiresMandate'>>) {
    setError(null);
    setPendingTool(tool.name);
    const next = { enabled: tool.enabled, requiresMandate: tool.requiresMandate, ...patch };
    try {
      await operatorApi.setToolPermission(server.id, tool.name, next);
      setTools((current) => current?.map((t) => (t.name === tool.name ? { ...t, ...next } : t)) ?? null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPendingTool(null);
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await operatorApi.deleteServer(server.id);
      notify(`« ${server.name} » est supprimé.`);
      onDeleted(server.id);
    } catch (e) {
      setConfirming(false);
      setError(describeError(e));
      setBusy(false);
    }
  }

  const headingId = `server-${server.id}`;
  return (
    <section aria-labelledby={headingId} className="rounded-card border border-line bg-surface p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="flex flex-wrap items-center gap-2 text-lg font-bold break-words">
            {server.name}
            {server.enabled ? null : <Badge>Désactivé</Badge>}
          </h2>
          <p className="mt-1 text-sm break-all text-ink-muted">{server.url}</p>
          {discoveredAt ? <p className="mt-1 text-xs text-ink-muted">Dernière découverte : {formatDate(discoveredAt)}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Découvrir les outils de ${server.name}`}
            disabled={discovering}
            leadingIcon={<Radar aria-hidden="true" className={cn('size-4', discovering && 'animate-pulse motion-reduce:animate-none')} />}
            onClick={() => void discover()}
          >
            {discovering ? 'Découverte…' : 'Découvrir les outils'}
          </Button>
          <Tooltip label="Supprimer">
            <IconButton
              label={`Supprimer ${server.name}`}
              disabled={busy}
              className="hover:bg-danger-soft hover:text-danger"
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden="true" className="size-[18px]" />
            </IconButton>
          </Tooltip>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Supprimer « ${server.name} » ?`}
        description="Ses outils seront supprimés aussi. Cette action est définitive."
        busy={busy}
        onConfirm={() => void remove()}
      />
      {error ? <InlineAlert className="mt-4">{error}</InlineAlert> : null}
      <div className="mt-4">
        {!tools ? (
          error ? null : (
            <p role="status" className="text-sm font-semibold text-ink-muted">
              Chargement des outils…
            </p>
          )
        ) : tools.length === 0 ? (
          <p className="text-sm text-ink-muted">Aucun outil. Lancez la découverte pour lire les outils du serveur.</p>
        ) : (
          <Table aria-label={`Outils de ${server.name}`}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Outil</TableHeaderCell>
                <TableHeaderCell>Activé</TableHeaderCell>
                <TableHeaderCell>Consentement requis</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tools.map((tool) => (
                <TableRow key={tool.name} className="h-auto">
                  <TableCell className="min-w-48 py-3">
                    <p className="font-mono text-[13px] font-semibold break-all">{tool.name}</p>
                    {tool.description ? <p className="mt-0.5 text-[13px] text-ink-muted">{tool.description}</p> : null}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={tool.enabled}
                      disabled={pendingTool === tool.name}
                      aria-label={`Activé : ${tool.name}`}
                      onCheckedChange={(enabled) => void toggle(tool, { enabled })}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      tone="ink"
                      checked={tool.requiresMandate}
                      disabled={pendingTool === tool.name}
                      aria-label={`Consentement requis : ${tool.name}`}
                      onCheckedChange={(requiresMandate) => void toggle(tool, { requiresMandate })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}
