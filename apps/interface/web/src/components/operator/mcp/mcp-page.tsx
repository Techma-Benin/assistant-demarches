'use client';

import { Button, InlineAlert, Toast } from '@techma/ui';
import { useCallback, useEffect, useState } from 'react';
import { describeError, operatorApi, type McpServer } from '@/lib/operator/api';
import { PageHeader, useToast } from '../ui';
import { ServerCard } from './server-card';
import { ServerForm } from './server-form';

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
        description="Ajoutez un serveur par son adresse, découvrez ses outils, puis activez-les un par un. Les outils nouveaux ou modifiés sont désactivés par défaut."
        actions={
          adding ? null : (
            <Button onClick={() => setAdding(true)} disabled={!servers}>
              Ajouter un serveur
            </Button>
          )
        }
      />
      {adding && servers ? (
        <div className="mb-6">
          <ServerForm
            existingIds={servers.map((s) => s.id)}
            onCancel={() => setAdding(false)}
            onSaved={(saved) => {
              setAdding(false);
              void load();
              toast.show(`« ${saved.name} » est ajouté. Lancez la découverte des outils.`);
            }}
          />
        </div>
      ) : null}
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
      <div className="fixed inset-x-4 bottom-4 z-30 flex justify-center">
        <Toast message={toast.message} onDismiss={toast.dismiss} />
      </div>
    </div>
  );
}
