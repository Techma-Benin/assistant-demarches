'use client';

import { Button, InlineAlert, Switch, TextField, cn } from '@techma/ui';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { isConnected, useConsole } from '@/components/admin/console/console-context';
import { Dialog } from '@/components/admin/dialog';
import { adminApi, type OfficialCreated } from '@/lib/admin/api';
import type { Official, OfficialRole } from '@/lib/admin/console-types';
import { toFailure } from '@/lib/admin/errors';
import { roleLabel } from '@/lib/admin/permissions';

const select =
  'min-h-11 w-full rounded-field border border-field bg-surface px-3 text-base text-ink disabled:cursor-not-allowed disabled:opacity-60';

function Select({ label, children, ...props }: { label: string; children: ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[15px] font-semibold text-ink">
        {label}
      </label>
      <select id={id} className={cn(select)} {...props}>
        {children}
      </select>
    </div>
  );
}

/**
 * Create (`official` null: `POST /officials`) or edit (`PUT /officials/{id}`: administration, role, active) an official.
 * Only offered with `officials:manage`. Only a super admin picks another administration or the super_admin role.
 */
export function OfficialForm({
  official,
  defaultAdministrationId,
  onClose,
  onCreated,
  onUpdated,
}: {
  official: Official | null;
  defaultAdministrationId: string | null;
  onClose: () => void;
  onCreated: (created: OfficialCreated) => void;
  onUpdated: (official: Official) => void;
}) {
  const { administrations, isSuperAdmin } = useConsole();
  const editing = official !== null;
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [role, setRole] = useState<OfficialRole>(official?.role ?? 'agent');
  const [administrationId, setAdministrationId] = useState<string>(
    official?.administrationId ?? defaultAdministrationId ?? '',
  );
  const [active, setActive] = useState(official?.active ?? true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base: OfficialRole[] = isSuperAdmin ? ['agent', 'admin', 'super_admin'] : ['agent', 'admin'];
  const roles = base.includes(role) ? base : [...base, role];
  const needsAdministration = role !== 'super_admin';
  const resolvedAdministration = needsAdministration ? administrationId || null : null;
  const valid =
    (editing || (email.trim() !== '' && displayName.trim() !== '' && jobTitle.trim() !== '')) &&
    (!needsAdministration || resolvedAdministration !== null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || sending) return;
    setSending(true);
    setError(null);
    try {
      if (editing) {
        onUpdated(await adminApi.updateOfficial(official.id, { administrationId: resolvedAdministration, role, active }));
      } else {
        onCreated(
          await adminApi.createOfficial({
            email: email.trim(),
            displayName: displayName.trim(),
            jobTitle: jobTitle.trim(),
            administrationId: resolvedAdministration,
            role,
          }),
        );
      }
    } catch (caught) {
      setError(toFailure(caught).message);
      setSending(false);
    }
  }

  return (
    <Dialog title={editing ? `Modifier ${official.displayName}` : 'Ajouter un agent'} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {editing ? null : (
          <>
            <TextField label="Adresse e-mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <TextField
              label="Nom affiché"
              required
              maxLength={200}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <TextField
              label="Fonction"
              required
              maxLength={200}
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
            />
          </>
        )}
        <Select label="Rôle" value={role} onChange={(e) => setRole(e.target.value as OfficialRole)}>
          {roles.map((value) => (
            <option key={value} value={value}>
              {roleLabel(value)}
            </option>
          ))}
        </Select>
        {isSuperAdmin && needsAdministration ? (
          <Select label="Administration" value={administrationId} onChange={(e) => setAdministrationId(e.target.value)}>
            <option value="" disabled>
              Choisir une administration
            </option>
            {administrations.map((candidate) => (
              <option key={candidate.id} value={candidate.id} disabled={!isConnected(candidate)}>
                {candidate.name}
                {isConnected(candidate) ? '' : ' (non connectée)'}
              </option>
            ))}
          </Select>
        ) : null}
        {editing ? (
          <Switch checked={active} onCheckedChange={setActive}>
            Compte actif
          </Switch>
        ) : null}
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" type="button" disabled={sending} onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={!valid || sending}>
            {editing ? 'Enregistrer' : 'Créer le compte'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
