'use client';

import { ChevronDown, Landmark } from 'lucide-react';
import { useConsole } from '../console/console-context';
import { MenuSelect } from './menu-select';

/** Top-of-sidebar ministry selector « Justice ▾ »; static text when only one ministry is accessible. */
export function MinistrySelector() {
  const { departments, department, departmentId, selectDepartment, loading } = useConsole();
  const name = department?.name ?? (loading ? 'Chargement…' : 'Aucun ministère');
  const frame = 'flex min-h-11 w-full items-center gap-2.5 rounded-2xl border border-line-subtle px-3';

  const label = (
    <>
      <Landmark aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
      <span className="min-w-0 flex-1 text-left text-sm leading-tight font-bold">{name}</span>
    </>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-xs font-bold tracking-[0.04em] text-ink-muted uppercase">Ministère</span>
      {departments.length < 2 ? (
        <div className={`${frame} bg-surface`} aria-label={`Ministère : ${name}`}>
          {label}
        </div>
      ) : (
        <MenuSelect
          menuLabel="Changer de ministère"
          triggerClassName={`${frame} bg-surface`}
          trigger={
            <>
              {label}
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
            </>
          }
          checkedId={departmentId}
          options={departments.map((candidate) => ({
            id: candidate.id,
            content: <span className="min-w-0 flex-1 truncate text-sm font-semibold">{candidate.name}</span>,
          }))}
          onSelect={(id) => void selectDepartment(id)}
        />
      )}
    </div>
  );
}
