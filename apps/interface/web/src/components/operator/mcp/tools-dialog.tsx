'use client';

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  InlineAlert,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@techma/ui';
import { useCallback, useEffect, useState } from 'react';
import { describeError, operatorApi, type McpServer, type McpTool } from '@/lib/operator/api';

export function ToolsDialog({
  server,
  open,
  onOpenChange,
  refreshEpoch,
}: {
  server: McpServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Incremented when discovery completes so an open dialog reloads its tools. */
  refreshEpoch: number;
}) {
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingTool, setPendingTool] = useState<string | null>(null);

  const loadTools = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const list = await operatorApi.listTools(server.id, signal);
        setTools(list.items);
      } catch (e) {
        if (!signal?.aborted) {
          setTools(null);
          setError(describeError(e));
        }
      }
    },
    [server.id],
  );

  useEffect(() => {
    if (!open) return;
    setTools(null);
    const controller = new AbortController();
    void loadTools(controller.signal);
    return () => controller.abort();
  }, [open, server.id, refreshEpoch, loadTools]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={server.name} description={server.url} onInteractOutside={(event) => event.preventDefault()}>
        {error ? <InlineAlert className="mb-4">{error}</InlineAlert> : null}
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
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Fermer</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
