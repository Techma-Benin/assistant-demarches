'use client';

import { Button, Dialog, DialogContent, InlineAlert } from '@techma/ui';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { describeError, operatorApi, type McpServer } from '@/lib/operator/api';
import { PageHeader, ToastViewport, useToast } from '../ui';
import { ServerCard } from './server-card';
import { SERVER_FORM_TITLE, ServerForm } from './server-form';

export function McpPage() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
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

  return (
    <div className="ui-rise">
      <PageHeader
        title="Connexions MCP"
        description="Les outils d’un serveur sont désactivés par défaut : activez-les un par un."
        actions={
          <Button leadingIcon={<Plus aria-hidden="true" className="size-5" />} onClick={() => setAdding(true)} disabled={!servers}>
            Ajouter un serveur
          </Button>
        }
      />
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
        <div className="flex flex-col gap-4">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              notify={toast.show}
              onDeleted={(id) => setServers((current) => current?.filter((s) => s.id !== id) ?? null)}
            />
          ))}
        </div>
      )}
      {servers ? (
        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogContent
            title={SERVER_FORM_TITLE}
            description="Indiquez son adresse, puis lancez la découverte de ses outils."
            onInteractOutside={(event) => event.preventDefault()}
          >
            <ServerForm
              existingIds={servers.map((s) => s.id)}
              onSaved={(saved) => {
                setAdding(false);
                void load();
                toast.show(`« ${saved.name} » est ajouté. Lancez la découverte des outils.`);
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      <ToastViewport toast={toast} />
    </div>
  );
}
