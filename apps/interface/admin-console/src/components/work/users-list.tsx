'use client';

import { Badge } from '@techma/ui';
import { useCallback } from 'react';
import { useConsole } from '@/components/console/console-context';
import { PaginatedTable, type Column } from '@/components/paginated-table';
import { departmentApi, type AdminUser } from '@/lib/department-api';
import { DepartmentGate } from './department-gate';

const LIMIT = 50;

function roleLabel(user: AdminUser, departmentId: string | undefined): string {
  if (user.superAdmin) return 'Super administrateur';
  const memberships = user.memberships.filter((m) => !departmentId || m.departmentId === departmentId);
  const roles = new Set(memberships.map((m) => m.role));
  if (roles.has('admin')) return 'Administrateur';
  if (roles.has('agent')) return 'Agent';
  return '-';
}

function Users({ departmentId }: { departmentId: string | undefined }) {
  const { departments } = useConsole();
  const names = new Map(departments.map((d) => [d.id, d.name]));
  const load = useCallback(
    (cursor: string | null) => departmentApi.listUsers({ departmentId, cursor, limit: LIMIT }),
    [departmentId],
  );
  const columns: Column<AdminUser>[] = [
    {
      header: 'Nom',
      cell: (u) => (
        <span className="flex flex-col">
          <span className="font-semibold">{u.displayName}</span>
          {u.email ? <span className="text-[13px] text-ink-muted">{u.email}</span> : null}
        </span>
      ),
    },
    { header: 'Rôle', cell: (u) => roleLabel(u, departmentId) },
    {
      header: 'Actif',
      cell: (u) => <Badge tone={u.active ? 'trust' : 'neutral'}>{u.active ? 'Actif' : 'Inactif'}</Badge>,
    },
    {
      header: 'Ministères',
      cell: (u) =>
        u.memberships.length === 0
          ? '-'
          : u.memberships.map((m) => names.get(m.departmentId) ?? m.departmentId).join(', '),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PaginatedTable
        label="Utilisateurs"
        noun="les utilisateurs"
        columns={columns}
        rowKey={(u) => u.subject}
        load={load}
        className="min-w-[640px]"
      />
      <p className="text-[13px] text-ink-subtle">
        Lecture seule : la création et la modification des utilisateurs ne sont pas disponibles dans cette version.
      </p>
    </div>
  );
}

export function UsersList() {
  return <DepartmentGate>{(departmentId) => <Users departmentId={departmentId} />}</DepartmentGate>;
}
