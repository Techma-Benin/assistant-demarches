'use client';

import { Button, DialogBody, DialogClose, DialogFooter, InlineAlert, TextField } from '@techma/ui';
import { useState, type FormEvent } from 'react';
import { describeError, operatorApi, type ModelConfig } from '@/lib/operator/api';
import {
  emptyModelForm,
  makeId,
  modelToForm,
  validateModelForm,
  type ModelFormErrors,
  type ModelFormValues,
} from '@/lib/operator/forms';
import { SelectField } from '../ui';

const PROTOCOLS = [
  { value: 'chat-completions', label: 'Chat Completions' },
  { value: 'responses', label: 'Responses' },
] as const;

export const modelFormTitle = (model?: ModelConfig) => (model ? `Modifier ${model.label}` : 'Ajouter un modèle');

/** Body and footer of the add/edit dialog (the dialog itself provides the title). */
export function ModelForm({
  model,
  existingIds,
  onSaved,
}: {
  /** Absent: creation. */
  model?: ModelConfig;
  existingIds: readonly string[];
  onSaved: (saved: ModelConfig) => void;
}) {
  const [values, setValues] = useState<ModelFormValues>(model ? modelToForm(model) : emptyModelForm);
  const [errors, setErrors] = useState<ModelFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ModelFormValues>(key: K) => (value: ModelFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const base = model ?? { id: makeId(values.label, existingIds), active: false };
    const result = validateModelForm(values, base, { requireKey: !model });
    setErrors(result.errors);
    if (!result.model) return;
    setSaving(true);
    try {
      const payload = result.apiKey ? { ...result.model, apiKey: result.apiKey } : result.model;
      const saved = model ? await operatorApi.updateModel(payload) : await operatorApi.createModel(payload);
      onSaved(saved);
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={modelFormTitle(model)} className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="grid gap-4 py-3 sm:grid-cols-2">
        {failure ? <InlineAlert className="sm:col-span-2">{failure}</InlineAlert> : null}
        <TextField label="Nom" required value={values.label} error={errors.label} onChange={(e) => set('label')(e.target.value)} />
        <TextField
          label="Modèle"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="ex. llama-3.3-70b-versatile"
          value={values.model}
          error={errors.model}
          onChange={(e) => set('model')(e.target.value)}
        />
        <div className="sm:col-span-2">
          <TextField
            label="Adresse du service (baseUrl)"
            required
            type="url"
            inputMode="url"
            autoComplete="off"
            hint="Point d’accès compatible OpenAI, par exemple https://api.groq.com/openai/v1."
            value={values.baseUrl}
            error={errors.baseUrl}
            onChange={(e) => set('baseUrl')(e.target.value)}
          />
        </div>
        <SelectField
          label="Protocole"
          required
          hint="Chat Completions : le plus courant."
          value={values.protocol}
          options={PROTOCOLS}
          onChange={(e) => set('protocol')(e.target.value as ModelFormValues['protocol'])}
        />
        <TextField
          label="Température"
          required
          type="number"
          inputMode="decimal"
          min={0}
          max={2}
          step={0.1}
          hint="Entre 0 (précis) et 2 (créatif)."
          value={values.temperature}
          error={errors.temperature}
          onChange={(e) => set('temperature')(e.target.value)}
        />
        <div className="sm:col-span-2">
          <TextField
            label="Clé d’accès"
            required={!model}
            type="password"
            name="model-access-secret"
            autoComplete="new-password"
            spellCheck={false}
            className="select-none"
            hint={
              model
                ? 'Laissez vide pour conserver la clé actuelle. Elle n’est jamais réaffichée.'
                : 'La clé est enregistrée chiffrée. Elle ne sera plus visible ensuite.'
            }
            value={values.apiKey}
            error={errors.apiKey}
            onCopy={(event) => event.preventDefault()}
            onCut={(event) => event.preventDefault()}
            onChange={(e) => set('apiKey')(e.target.value)}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Annuler</Button>
        </DialogClose>
        <Button type="submit" disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </DialogFooter>
    </form>
  );
}
