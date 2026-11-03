'use client';

import { Button, InlineAlert, Tile } from '@techma/ui';
import type { ReactNode } from 'react';
import { useConsole } from './console-context';

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: lines }, (_, line) => (
        <span key={line} className="block h-14 animate-pulse rounded-tile bg-sunken" />
      ))}
    </div>
  );
}

/**
 * Resolves the administration a page works on. `administrationId` is undefined for an agent or admin
 * (the server forces their own); a super admin must have a connected administration selected first.
 */
export function AdministrationGate({
  header,
  children,
}: {
  /** Shown above the loading / prompt states (when the page renders its own header once ready). */
  header?: ReactNode;
  children: (administrationId: string | undefined) => ReactNode;
}) {
  const { scopeId, isSuperAdmin, administrations, loading, error, reload } = useConsole();
  if (loading) return <>{header}<Skeleton /></>;
  if (error) {
    return (
      <>
        {header}
        <div className="flex flex-wrap items-center gap-3">
          <InlineAlert>Impossible de charger votre profil.</InlineAlert>
          <Button variant="secondary" size="sm" onClick={reload}>
            Réessayer
          </Button>
        </div>
      </>
    );
  }
  if (isSuperAdmin && scopeId === undefined) {
    return (
      <>
        {header}
        <Tile tone="outline" className="text-center">
          <p className="font-display text-2xl font-extrabold tracking-[-0.035em]">
            {administrations.length === 0 ? 'Aucune administration' : 'Aucune administration connectée'}
          </p>
          <p className="mt-2 text-ink-muted">
            Aucune administration connectée n’est disponible : il n’y a pas encore de données à consulter.
          </p>
        </Tile>
      </>
    );
  }
  return <>{children(scopeId)}</>;
}
