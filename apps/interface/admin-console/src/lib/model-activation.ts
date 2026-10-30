import { C3Error, c3, type ModelConfig } from './c3-client';
import { toSaveFailure } from './error-messages';

export interface Activation {
  /** Models as confirmed by the backend, in order (new active first). */
  saved: ModelConfig[];
}

const key = (model: ModelConfig) => `model-${model.id}-${crypto.randomUUID()}`;

/**
 * « Exactement un modèle actif » : activates `next` first, then deactivates `current`
 * (two PUTs, a new Idempotency-Key each). Rejects with the failing PUT's error.
 */
export async function activateModel(next: ModelConfig, current: ModelConfig | null): Promise<Activation> {
  const activated = await c3.updateModel({ ...next, active: true }, key(next));
  if (current === null || current.id === next.id) return { saved: [activated] };
  const deactivated = await c3.updateModel({ ...current, active: false }, key(current));
  return { saved: [activated, deactivated] };
}

/** The backend's own explanation when it rejects the change (409/422…), else the generic save message. */
export function describeActivationError(error: unknown): string {
  if (error instanceof C3Error && error.problem?.detail) return error.problem.detail;
  return toSaveFailure(error).message;
}
