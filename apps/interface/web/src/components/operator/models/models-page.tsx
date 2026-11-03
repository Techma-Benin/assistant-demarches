'use client';

import { Badge, Button, InlineAlert, Toast } from '@techma/ui';
import { useCallback, useEffect, useState } from 'react';
import { describeError, operatorApi, type ModelConfig } from '@/lib/operator/api';
import { PageHeader, useToast } from '../ui';
import { ModelForm } from './model-form';

type Editing = { kind: 'new' } | { kind: 'edit'; id: string } | null;

export function ModelsPage() {
  const [models, setModels] = useState<ModelConfig[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      setModels(await operatorApi.listModels(signal));
    } catch (error) {
      if (!signal?.aborted) setLoadError(describeError(error));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function activate(model: ModelConfig) {
    setActionError(null);
    setBusyId(model.id);
    try {
      await operatorApi.updateModel({ ...model, active: true });
      await load();
      toast.show(`« ${model.label} » est le modèle actif.`);
    } catch (error) {
      setActionError(describeError(error));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(model: ModelConfig) {
    setActionError(null);
    setBusyId(model.id);
    try {
      await operatorApi.deleteModel(model.id);
      setConfirmId(null);
      await load();
      toast.show(`« ${model.label} » est supprimé.`);
    } catch (error) {
      // e.g. the server refuses to delete the active model: show its reason and keep the list as is.
      setConfirmId(null);
      setActionError(describeError(error));
    } finally {
      setBusyId(null);
    }
  }

  const editedModel = editing?.kind === 'edit' ? models?.find((m) => m.id === editing.id) : undefined;

  return (
    <div className="ui-rise">
      <PageHeader
        title="Modèles d’IA"
        description="L’assistant utilise le modèle actif, sans redémarrage. Un seul modèle est actif à la fois."
        actions={
          editing ? null : (
            <Button onClick={() => setEditing({ kind: 'new' })} disabled={!models}>
              Ajouter un modèle
            </Button>
          )
        }
      />
      {actionError ? <InlineAlert className="mb-4">{actionError}</InlineAlert> : null}
      {editing && models && (editing.kind === 'new' || editedModel) ? (
        <div className="mb-6">
          <ModelForm
            key={editing.kind === 'edit' ? editing.id : 'new'}
            model={editedModel}
            existingIds={models.map((m) => m.id)}
            onCancel={() => setEditing(null)}
            onSaved={(saved) => {
              setEditing(null);
              setActionError(null);
              void load();
              toast.show(`« ${saved.label} » est enregistré.`);
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
      ) : !models ? (
        <p role="status" className="text-sm font-semibold text-ink-muted">
          Chargement…
        </p>
      ) : models.length === 0 ? (
        <p className="text-base text-ink-muted">Aucun modèle configuré. Ajoutez-en un, puis activez-le.</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Modèles">
          {models.map((model) => (
            <li key={model.id} className="rounded-card border border-line bg-surface p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold break-words">
                    {model.label}
                    {model.active ? <Badge tone="trust">Actif</Badge> : null}
                  </h2>
                  <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm text-ink-muted sm:grid-cols-2">
                    <div>
                      <dt className="inline font-semibold">Modèle : </dt>
                      <dd className="inline break-all">{model.model}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Protocole : </dt>
                      <dd className="inline">{model.protocol}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="inline font-semibold">Adresse : </dt>
                      <dd className="inline break-all">{model.baseUrl}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Variable de la clé : </dt>
                      <dd className="inline font-mono break-all">{model.apiKeyRef}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold">Température : </dt>
                      <dd className="inline">{model.temperature}</dd>
                    </div>
                  </dl>
                </div>
                <div className="flex flex-wrap gap-2">
                  {model.active ? null : (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Activer ${model.label}`}
                      disabled={busyId === model.id}
                      onClick={() => void activate(model)}
                    >
                      Activer
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Modifier ${model.label}`}
                    onClick={() => setEditing({ kind: 'edit', id: model.id })}
                  >
                    Modifier
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Supprimer ${model.label}`}
                    disabled={busyId === model.id}
                    onClick={() => setConfirmId(model.id)}
                  >
                    Supprimer
                  </Button>
                </div>
              </div>
              {confirmId === model.id ? (
                <div role="group" aria-label={`Confirmer la suppression de ${model.label}`} className="mt-4 flex flex-wrap items-center gap-3 rounded-field bg-danger-soft p-3">
                  <p className="text-sm font-semibold text-danger">Supprimer « {model.label} » ? Cette action est définitive.</p>
                  <Button size="sm" disabled={busyId === model.id} onClick={() => void remove(model)}>
                    Confirmer la suppression
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirmId(null)}>
                    Annuler
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="fixed inset-x-4 bottom-4 z-30 flex justify-center">
        <Toast message={toast.message} onDismiss={toast.dismiss} />
      </div>
    </div>
  );
}
