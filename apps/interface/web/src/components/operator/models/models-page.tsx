'use client';

import { Badge, Button, Dialog, DialogContent, IconButton, InlineAlert, Tooltip, cn } from '@techma/ui';
import { CircleCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { describeError, operatorApi, type ModelConfig } from '@/lib/operator/api';
import { ConfirmDialog } from '../confirm-dialog';
import { PageHeader, ToastViewport, useDialogTarget, useToast } from '../ui';
import { ModelForm, modelFormTitle } from './model-form';

type Editing = { kind: 'new' } | { kind: 'edit'; model: ModelConfig };

const AVATAR_TONES = [
  'bg-trust-soft text-trust-text',
  'bg-sun text-warning',
  'bg-danger-soft text-danger',
  'bg-sunken text-ink',
] as const;

/** Stable colour per model, so a row keeps its look from one visit to the next. */
function avatarTone(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

function roleLabel(model: ModelConfig): string {
  return model.role === 'transcription' ? 'Transcription' : 'Discussion';
}

function sameRole(left: ModelConfig, right: ModelConfig): boolean {
  return (left.role === 'transcription') === (right.role === 'transcription');
}

function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : label.trim().slice(0, 2)).toUpperCase();
}

function ModelRow({
  model,
  busy,
  onActivate,
  onEdit,
  onDelete,
}: {
  model: ModelConfig;
  busy: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      className={cn(
        'ui-rise flex flex-wrap items-center gap-x-6 gap-y-3 rounded-card border p-4 transition-[background-color,border-color] duration-(--ui-dur-press) ease-(--ui-ease-out) md:px-6',
        model.active
          ? 'border-trust-line bg-trust-soft hover:border-trust'
          : 'border-line bg-surface hover:border-line-strong hover:bg-sunken',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('grid size-12 shrink-0 place-items-center rounded-2xl font-display text-[15px] font-extrabold', avatarTone(model.id))}
      >
        {initials(model.label)}
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[17px] leading-tight font-bold break-words">
          {model.label}
          <span className="text-[13px] font-semibold text-ink-muted">{roleLabel(model)}</span>
          {model.active ? (
            <Badge tone="trust" className="bg-trust text-on-trust" icon={<CircleCheck aria-hidden="true" className="size-3.5" />}>
              Actif
            </Badge>
          ) : null}
        </h2>
        <p className="mt-0.5 font-mono text-[13px] break-all text-ink-muted">{model.model}</p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {model.active ? null : (
          <Button size="sm" variant="secondary" aria-label={`Activer ${model.label}`} disabled={busy} onClick={onActivate}>
            Activer
          </Button>
        )}
        <Tooltip label="Modifier">
          <IconButton
            label={`Modifier ${model.label}`}
            className="text-ink-muted hover:bg-sunken hover:text-ink"
            onClick={onEdit}
          >
            <Pencil aria-hidden="true" className="size-[18px]" />
          </IconButton>
        </Tooltip>
        <Tooltip label="Supprimer">
          <IconButton
            label={`Supprimer ${model.label}`}
            disabled={busy}
            className="text-ink-muted hover:bg-danger-soft hover:text-danger"
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" className="size-[18px]" />
          </IconButton>
        </Tooltip>
      </div>
    </li>
  );
}

export function ModelsPage() {
  const [models, setModels] = useState<ModelConfig[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const editor = useDialogTarget<Editing>();
  const removal = useDialogTarget<ModelConfig>();
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

  /** `previous` is the model to put back by the « Annuler » of the confirmation. */
  async function activate(model: ModelConfig, previous?: ModelConfig) {
    setActionError(null);
    setBusyId(model.id);
    try {
      await operatorApi.updateModel({ ...model, active: true });
      await load();
      toast.show(
        `« ${model.label} » est le modèle de ${model.role === 'transcription' ? 'transcription' : 'discussion'} actif.`,
        previous ? { label: 'Annuler', onClick: () => void activate(previous) } : undefined,
      );
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
      removal.close();
      await load();
      toast.show(`« ${model.label} » est supprimé.`);
    } catch (error) {
      // e.g. the server refuses to delete the active model: show its reason and keep the list as is.
      removal.close();
      setActionError(describeError(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="ui-rise">
      <PageHeader
        title="Modèles d’IA"
        description="Un modèle de discussion répond à l’assistant et un modèle de transcription transcrit la voix, sans redémarrage."
        actions={
          <Button leadingIcon={<Plus aria-hidden="true" className="size-5" />} onClick={() => editor.show({ kind: 'new' })} disabled={!models}>
            Ajouter un modèle
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
      ) : !models ? (
        <p role="status" className="text-sm font-semibold text-ink-muted">
          Chargement…
        </p>
      ) : models.length === 0 ? (
        <p className="text-base text-ink-muted">Aucun modèle configuré. Ajoutez-en un, puis activez-le.</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Modèles">
          {models.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              busy={busyId === model.id}
              onActivate={() => void activate(model, models.find((item) => item.id !== model.id && item.active && sameRole(item, model)))}
              onEdit={() => editor.show({ kind: 'edit', model })}
              onDelete={() => removal.show(model)}
            />
          ))}
        </ul>
      )}
      {editor.target && models ? (
        <Dialog open={editor.open} onOpenChange={editor.onOpenChange}>
          <DialogContent
            size="lg"
            title={modelFormTitle(editor.target.kind === 'edit' ? editor.target.model : undefined)}
            onInteractOutside={(event) => event.preventDefault()}
          >
            <ModelForm
              model={editor.target.kind === 'edit' ? editor.target.model : undefined}
              existingIds={models.map((m) => m.id)}
              onSaved={(saved) => {
                editor.close();
                setActionError(null);
                void load();
                toast.show(`« ${saved.label} » est enregistré.`);
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      {removal.target ? (
        <ConfirmDialog
          open={removal.open}
          onOpenChange={removal.onOpenChange}
          title={`Supprimer « ${removal.target.label} » ?`}
          description="Cette action est définitive."
          busy={busyId === removal.target.id}
          onConfirm={() => void remove(removal.target!)}
        />
      ) : null}
      <ToastViewport toast={toast} />
    </div>
  );
}
