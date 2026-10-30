'use client';

import { cn } from '@techma/ui';
import { ChevronsUpDown } from 'lucide-react';
import { sessionRoleLabel } from '@/lib/permissions';
import { useConsole } from '../console/console-context';
import { MenuSelect } from './menu-select';

/** Initials of the label, skipping short words: « Agent Justice » → « AJ ». */
function initials(label: string): string {
  const words = label.split(/\s+/).filter((word) => word.length > 2);
  return (words.length ? words : [label]).slice(0, 2).map((word) => word[0].toUpperCase()).join('');
}

/** Square badge: ink for the platform-wide super admin, green for a ministry agent. */
function Avatar({ label, superAdmin, size = 'md' }: { label: string; superAdmin: boolean; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[10px] font-display font-extrabold tracking-[-0.02em]',
        size === 'md' ? 'size-9 text-[13px]' : 'size-8 text-xs',
        superAdmin ? 'bg-action text-on-action' : 'bg-trust text-on-trust',
      )}
    >
      {initials(label)}
    </span>
  );
}

/** « Session de démonstration »: who the person acts as, and a menu to switch between the demo sessions. */
export function IdentitySwitcher() {
  const { sessions, activeSessionId, profile, switchSession } = useConsole();
  const active = sessions.find((session) => session.id === activeSessionId);
  if (!active) return null;
  const isSuper = (id: string) => sessionRoleLabel(id, id === activeSessionId ? profile : null) === 'Super admin';

  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-xs font-bold tracking-[0.04em] text-ink-muted uppercase">Session de démonstration</span>
      <MenuSelect
        menuLabel="Changer de session de démonstration"
        triggerClassName="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line-subtle bg-surface p-2.5 pr-3"
        trigger={
          <>
            <Avatar label={active.label} superAdmin={isSuper(active.id)} />
            <span className="flex min-w-0 flex-1 flex-col text-left">
              <span className="text-sm leading-tight font-bold">{active.label}</span>
              <span className="truncate text-xs leading-tight text-ink-muted">
                {sessionRoleLabel(active.id, profile)}
              </span>
            </span>
            <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
          </>
        }
        checkedId={activeSessionId}
        options={sessions.map((session) => ({
          id: session.id,
          content: (
            <>
              <Avatar label={session.label} superAdmin={isSuper(session.id)} size="sm" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm leading-tight font-semibold">{session.label}</span>
                <span className="text-xs leading-tight text-ink-muted">
                  {sessionRoleLabel(session.id, session.id === activeSessionId ? profile : null)}
                </span>
              </span>
            </>
          ),
        }))}
        onSelect={(id) => void switchSession(id)}
      />
    </div>
  );
}
