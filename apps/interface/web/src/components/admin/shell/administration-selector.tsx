'use client';

import { ChevronDown, Landmark } from 'lucide-react';
import { isConnected, useConsole } from '../console/console-context';
import { MenuSelect } from './menu-select';

/**
 * Top-of-sidebar administration selector « Justice ▾ », only for a super admin (`administrations:all`);
 * static text for everyone else. Only connected administrations are listed.
 */
export function AdministrationSelector() {
  const { administrations, administration, administrationId, isSuperAdmin, selectAdministration, loading } = useConsole();
  const name = administration?.name ?? (loading ? 'Chargement…' : 'Aucune administration');
  const frame = 'flex min-h-11 w-full items-center gap-2.5 rounded-2xl border border-line-subtle px-3';

  const label = (
    <>
      <Landmark aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
      <span className="min-w-0 flex-1 text-left text-sm leading-tight font-bold">{name}</span>
    </>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-xs font-bold tracking-[0.04em] text-ink-muted uppercase">Administration</span>
      {!isSuperAdmin || administrations.length === 0 ? (
        <div className={`${frame} bg-surface`} aria-label={`Administration : ${name}`}>
          {label}
        </div>
      ) : (
        <MenuSelect
          menuLabel="Changer d’administration"
          triggerClassName={`${frame} bg-surface`}
          trigger={
            <>
              {label}
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
            </>
          }
          checkedId={administrationId}
          options={administrations.filter(isConnected).map((candidate) => ({
            id: candidate.id,
            content: <span className="truncate text-sm font-semibold">{candidate.name}</span>,
          }))}
          onSelect={(id) => void selectAdministration(id)}
        />
      )}
    </div>
  );
}
