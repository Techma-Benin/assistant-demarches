'use client';

import { Button, InlineAlert, Tile } from '@techma/ui';
import type { ReactNode } from 'react';
import { useConsole } from '@/components/console/console-context';

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
 * Resolves the department the page works on. `departmentId` is undefined when the agent has a single
 * department (the Backend infers it); a super admin must pick one first.
 */
export function DepartmentGate({
  header,
  children,
}: {
  /** Shown above the loading / prompt states (when the page renders its own header once ready). */
  header?: ReactNode;
  children: (departmentId: string | undefined) => ReactNode;
}) {
  const { departmentId, isSuperAdmin, loading, error, reload } = useConsole();
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
  if (!departmentId && isSuperAdmin) {
    return (
      <>
        {header}
        <Tile tone="outline" className="text-center">
          <p className="font-display text-2xl font-extrabold tracking-[-0.035em]">Choisissez un ministère</p>
          <p className="mt-2 text-ink-muted">Sélectionnez un ministère dans le menu pour consulter ses dossiers.</p>
        </Tile>
      </>
    );
  }
  return <>{children(departmentId ?? undefined)}</>;
}
