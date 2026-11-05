'use client';

import { Button, Dialog, DialogContent, InlineAlert } from '@techma/ui';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { describeError, operatorApi, type McpServer } from '@/lib/operator/api';
import { ConfirmDialog } from '../confirm-dialog';
import { PageHeader, ToastViewport, useDialogTarget, useToast } from '../ui';
import { ConnectionRow } from './connection-row';
import { serverFormTitle, ServerForm } from './server-form';
import { ToolsDialog } from './tools-dialog';

type Editing = { kind: 'new' } | { kind: 'edit'; server: McpServer };

export function McpPage() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toolsEpoch, setToolsEpoch] = useState<Record<string, number>>({});
  const editor = useDialogTarget<Editing>();
  const tools = useDialogTarget<McpServer>();
  const removal = useDialogTarget<McpServer>();
  const toast = useToast();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      setServers(await operatorApi.listServers(signal));
    } catch (error) {
      if (!signal?.aborted) setLoadError(describeError(error));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function bumpTools(serverId: string) {
    setToolsEpoch((current) => ({ ...current, [serverId]: (current[serverId] ?? 0) + 1 }));
  }

  async function remove(server: McpServer) {
    setActionError(null);
    setBusyId(server.id);
    try {
      await operatorApi.deleteServer(server.id);
      removal.close();
      await load();
      toast.show(`« ${server.name} » est supprimé.`);
    } catch (error) {
      removal.close();
      setActionError(describeError(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="ui-rise">
      <PageHeader
        title="Connexions MCP"
        description="Les outils d’un serveur sont désactivés par défaut : activez-les un par un."
        actions={
          <Button leadingIcon={<Plus aria-hidden="true" className="size-5" />} onClick={() => editor.show({ kind: 'new' })} disabled={!servers}>
            Ajouter une connexion
          </Button>
        }
      />
      {actionError ? <InlineAlert className="mb-4">{actionError}</InlineAlert> : null}
      {loadError ? (
        <div className="flex max-w-xl flex-col items-start gap-4">
          <InlineAlert>{loadError}</InlineAlert>
          <Button variant="outline" onClick={() => void load()}>
            Réessayer
          </Button>
        </div>
      ) : !servers ? (
        <p role="status" className="text-sm font-semibold text-ink-muted">
          Chargement…
        </p>
      ) : servers.length === 0 ? (
        <p className="text-base text-ink-muted">Aucun serveur MCP. Ajoutez-en un par son adresse.</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Connexions MCP">
          {servers.map((server) => (
            <ConnectionRow
              key={server.id}
              server={server}
              busy={busyId === server.id}
              onOpenTools={() => tools.show(server)}
              onEdit={() => editor.show({ kind: 'edit', server })}
              onDelete={() => removal.show(server)}
              onDiscoverDone={() => bumpTools(server.id)}
              notify={toast.show}
            />
          ))}
        </ul>
      )}
      {editor.target && servers ? (
        <Dialog open={editor.open} onOpenChange={editor.onOpenChange}>
          <DialogContent
            title={serverFormTitle(editor.target.kind === 'edit' ? editor.target.server : undefined)}
            description={
              editor.target.kind === 'new'
                ? 'Indiquez son adresse, puis lancez la découverte de ses outils.'
                : undefined
            }
            onInteractOutside={(event) => event.preventDefault()}
          >
            <ServerForm
              server={editor.target.kind === 'edit' ? editor.target.server : undefined}
              existingIds={servers.map((s) => s.id)}
              onSaved={(saved) => {
                editor.close();
                setActionError(null);
                void load();
                toast.show(
                  editor.target?.kind === 'edit'
                    ? `« ${saved.name} » est enregistré.`
                    : `« ${saved.name} » est ajouté. Lancez la découverte des outils.`,
                );
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      {tools.target ? (
        <ToolsDialog
          server={tools.target}
          open={tools.open}
          onOpenChange={tools.onOpenChange}
          refreshEpoch={toolsEpoch[tools.target.id] ?? 0}
        />
      ) : null}
      {removal.target ? (
        <ConfirmDialog
          open={removal.open}
          onOpenChange={removal.onOpenChange}
          title={`Supprimer « ${removal.target.name} » ?`}
          description="Ses outils seront supprimés aussi. Cette action est définitive."
          busy={busyId === removal.target.id}
          onConfirm={() => void remove(removal.target!)}
        />
      ) : null}
      <ToastViewport toast={toast} />
    </div>
  );
}
