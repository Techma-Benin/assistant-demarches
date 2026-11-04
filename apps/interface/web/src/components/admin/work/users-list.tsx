'use client';

import { Badge, Button, Toast } from '@techma/ui';
import { UserPlus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { AdministrationGate } from '@/components/admin/console/administration-gate';
import { useConsole } from '@/components/admin/console/console-context';
import { RequirePermission } from '@/components/admin/console/require-permission';
import { PageHeader } from '@/components/admin/page-header';
import { PaginatedTable, type Column } from '@/components/admin/paginated-table';
import { useToast } from '@/components/admin/use-toast';
import { adminApi, type OfficialCreated } from '@/lib/admin/api';
import type { Official } from '@/lib/admin/console-types';
import { roleLabel } from '@/lib/admin/permissions';
import { OfficialForm } from './official-form';
import { PasswordDialog } from './password-dialog';

const LIMIT = 50;

type Editing = { kind: 'create' } | { kind: 'edit'; official: Official } | null;

function Users({ administrationId }: { administrationId: string | undefined }) {
  const { administrations, administrationId: selectedId, can, isSuperAdmin } = useConsole();
  const canManage = can('officials:manage');
  const canCreate = canManage && isSuperAdmin;
  const names = new Map(administrations.map((a) => [a.id, a.name]));
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const [created, setCreated] = useState<OfficialCreated | null>(null);
  const toast = useToast();
  const load = useCallback(
    (cursor: string | null) => {
      void refresh; // a new value reloads the list from the first page
      return adminApi.listOfficials({ administrationId, cursor, limit: LIMIT });
    },
    [administrationId, refresh],
  );
  const columns: Column<Official>[] = [
    {
      header: 'Nom',
      cell: (u) => (
        <span className="flex flex-col">
          <span className="font-semibold">{u.displayName}</span>
          <span className="text-[13px] text-ink-muted">{u.email}</span>
        </span>
      ),
    },
    { header: 'Fonction', cell: (u) => u.jobTitle },
    { header: 'Rôle', cell: (u) => roleLabel(u.role) },
    {
      header: 'Administration',
      cell: (u) => (u.administrationId ? (names.get(u.administrationId) ?? u.administrationId) : 'Toutes'),
    },
    {
      header: 'Actif',
      cell: (u) => <Badge tone={u.active ? 'trust' : 'neutral'}>{u.active ? 'Actif' : 'Inactif'}</Badge>,
    },
    ...(canManage
      ? [
          {
            header: 'Actions',
            cell: (u: Official) => (
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Modifier ${u.displayName}`}
                onClick={() => setEditing({ kind: 'edit', official: u })}
              >
                Modifier
              </Button>
            ),
          },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <div className={`flex items-center gap-3 ${canCreate ? 'justify-between' : 'justify-end'}`}>
          {canCreate ? (
            <Button onClick={() => setEditing({ kind: 'create' })}>
              <UserPlus aria-hidden="true" className="size-4" />
              Ajouter un agent
            </Button>
          ) : null}
          <Toast message={toast.message} onDismiss={toast.dismiss} />
        </div>
      ) : null}
      <PaginatedTable
        label="Utilisateurs"
        noun="les utilisateurs"
        columns={columns}
        rowKey={(u) => u.id}
        load={load}
        className="min-w-[760px]"
      />
      {editing ? (
        <OfficialForm
          official={editing.kind === 'edit' ? editing.official : null}
          defaultAdministrationId={selectedId}
          onClose={() => setEditing(null)}
          onCreated={(result) => {
            setEditing(null);
            setCreated(result);
            setRefresh((value) => value + 1);
          }}
          onUpdated={() => {
            setEditing(null);
            setRefresh((value) => value + 1);
            toast.show('Modifications enregistrées.');
          }}
        />
      ) : null}
      {created ? (
        <PasswordDialog
          displayName={created.official.displayName}
          password={created.temporaryPassword}
          onClose={() => setCreated(null)}
        />
      ) : null}
    </div>
  );
}

export function UsersList() {
  return (
    <RequirePermission permission="officials:read">
      <AdministrationGate>{(administrationId) => <Users administrationId={administrationId} />}</AdministrationGate>
    </RequirePermission>
  );
}
