import type { Identity } from './permissions';

/**
 * Defence in depth only: the Backend filters by the token's administrationId, this keeps the screens
 * consistent if a wider list ever reaches the browser. Platform sees everything, an administration its own.
 */
export function canSeeProcedure(identity: Identity | null | undefined, procedure: { administrationId: string }): boolean {
  if (!identity) return false;
  return identity.kind === 'platform' || identity.administrationId === procedure.administrationId;
}

export function visibleProcedures<T extends { administrationId: string }>(
  identity: Identity | null | undefined,
  items: readonly T[],
): T[] {
  return items.filter((item) => canSeeProcedure(identity, item));
}
