'use client';

import { InlineAlert, StatusPill } from '@techma/ui';
import { roleLabel } from '@/lib/admin/permissions';
import { useConsole } from './console-context';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line-subtle bg-surface p-5">
      <h2 className="mb-3 text-xs font-bold tracking-[0.04em] text-ink-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

/** Read-only view of `GET /v1/admin/me`. */
export function ProfileView() {
  const { profile, departments, loading, error } = useConsole();
  if (error) return <InlineAlert>{error}</InlineAlert>;
  if (!profile) return loading ? <p role="status" className="text-sm text-ink-muted">Chargement…</p> : null;

  const nameOf = (id: string) => departments.find((department) => department.id === id)?.name ?? id;
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Section title="Identité">
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-display text-2xl font-extrabold tracking-[-0.03em]">{profile.displayName}</p>
          {profile.superAdmin ? <StatusPill status="submitted">Super admin</StatusPill> : null}
        </div>
        {profile.email ? <p className="mt-1 text-sm text-ink-muted">{profile.email}</p> : null}
      </Section>
      <Section title="Ministères">
        {profile.memberships.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {profile.superAdmin ? 'Accès à tous les ministères.' : 'Aucun ministère rattaché.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {profile.memberships.map((membership) => (
              <li key={membership.departmentId} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold">{nameOf(membership.departmentId)}</span>
                <StatusPill status={membership.role === 'admin' ? 'validated' : 'info'}>
                  {roleLabel(membership.role)}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Permissions">
        {profile.permissions.length === 0 ? (
          <p className="text-sm text-ink-muted">Aucune permission.</p>
        ) : (
          <ul aria-label="Permissions" className="flex flex-wrap gap-2">
            {profile.permissions.map((permission) => (
              <li key={permission} className="rounded-pill bg-sunken px-2.5 py-1 font-mono text-xs">
                {permission}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Source">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">Fournisseur d’identité</dt>
          <dd className="font-mono">{profile.identityProvider}</dd>
          <dt className="text-ink-muted">Annuaire</dt>
          <dd className="font-mono">{profile.directorySource}</dd>
        </dl>
      </Section>
    </div>
  );
}
