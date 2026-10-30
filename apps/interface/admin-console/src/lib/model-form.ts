import type { ModelConfig } from './c3-client';

export interface ModelDraft {
  provider: string;
  model: string;
  promptVersion: string;
  temperature: string;
  active: boolean;
}

export type ModelErrors = Partial<Record<keyof ModelDraft, string>>;

export const toModelDraft = (model: ModelConfig): ModelDraft => ({
  provider: model.provider,
  model: model.model,
  promptVersion: model.promptVersion,
  temperature: String(model.temperature),
  active: model.active,
});

export function validateModel(draft: ModelDraft): ModelErrors {
  const errors: ModelErrors = {};
  if (!draft.provider.trim()) errors.provider = 'Le fournisseur est obligatoire.';
  if (!draft.model.trim()) errors.model = 'Le modèle est obligatoire.';
  if (!draft.promptVersion.trim()) errors.promptVersion = 'La version des instructions est obligatoire.';
  const temperature = draft.temperature.trim() === '' ? NaN : Number(draft.temperature);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    errors.temperature = 'La température doit être un nombre entre 0 et 2.';
  }
  return errors;
}

/** Full replacement: every field of the loaded model, with the edits applied. */
export const toModelConfig = (draft: ModelDraft, base: ModelConfig): ModelConfig => ({
  ...base,
  provider: draft.provider,
  model: draft.model,
  promptVersion: draft.promptVersion,
  temperature: Number(draft.temperature),
  active: draft.active,
});
