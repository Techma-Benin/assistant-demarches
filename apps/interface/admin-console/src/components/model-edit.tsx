'use client';

import { Switch, TextField, Toast } from '@techma/ui';
import { c3, type ModelConfig } from '@/lib/c3-client';
import { findInPages } from '@/lib/find-resource';
import { toModelConfig, toModelDraft, validateModel, type ModelDraft } from '@/lib/model-form';
import { EditForm, FormSection, ReadOnlyField } from './edit/edit-form';
import { useResourceEditor } from './edit/use-resource-editor';
import { ReadOnlyNote } from './session/read-only-note';
import { useSession } from './session/session-context';
import { useToast } from './use-toast';

export function ModelEdit({ id }: { id: string }) {
  const editor = useResourceEditor<ModelConfig, ModelDraft>({
    keyPrefix: `model-${id}`,
    load: () => findInPages((params) => c3.listModels(params), (model) => model.id === id),
    save: (model, key) => c3.updateModel(model, key),
    toDraft: toModelDraft,
    toResource: toModelConfig,
    validate: validateModel,
  });
  const { errors, update } = editor;
  const toast = useToast();
  const readOnly = !useSession().can('models.edit');

  return (
    <EditForm
      editor={editor}
      title={(model) => model.id}
      fallbackTitle={id}
      backHref="/models"
      backLabel="Retour aux modèles"
      onSubmit={() => !readOnly && void editor.save().then((saved) => saved && toast.show('Modèle enregistré'))}
      actionsNote={readOnly ? <ReadOnlyNote /> : undefined}
      headerActions={<Toast message={toast.message} onDismiss={toast.dismiss} />}
    >
      {(draft) => (
        <FormSection title="Configuration du modèle">
          <ReadOnlyField label="Identifiant" value={id} />
          <TextField
            label="Fournisseur"
            required
            value={draft.provider}
            error={errors.provider}
            readOnly={readOnly}
            onChange={(event) => update({ provider: event.target.value })}
          />
          <TextField
            label="Modèle"
            required
            value={draft.model}
            error={errors.model}
            readOnly={readOnly}
            onChange={(event) => update({ model: event.target.value })}
          />
          <TextField
            label="Version des instructions"
            required
            value={draft.promptVersion}
            error={errors.promptVersion}
            readOnly={readOnly}
            onChange={(event) => update({ promptVersion: event.target.value })}
          />
          <TextField
            label="Température"
            hint="Entre 0 et 2."
            type="number"
            min={0}
            max={2}
            step={0.1}
            required
            value={draft.temperature}
            error={errors.temperature}
            readOnly={readOnly}
            onChange={(event) => update({ temperature: event.target.value })}
          />
          <Switch checked={draft.active} tone="trust" disabled={readOnly} onCheckedChange={(active) => update({ active })}>
            Actif
          </Switch>
        </FormSection>
      )}
    </EditForm>
  );
}
