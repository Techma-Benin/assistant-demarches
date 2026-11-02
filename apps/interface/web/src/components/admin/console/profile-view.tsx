'use client';

import { Button, InlineAlert, StatusPill, TextField } from '@techma/ui';
import { useState, type FormEvent } from 'react';
import { adminApi } from '@/lib/admin/api';
import { toFailure } from '@/lib/admin/errors';
import { roleLabel } from '@/lib/admin/permissions';
import { useConsole } from './console-context';

/** Photo limit from `PUT /v1/admin/me/avatar`: 2 Mio, JPEG or PNG. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png'] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line-subtle bg-surface p-5">
      <h2 className="mb-3 text-xs font-bold tracking-[0.04em] text-ink-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/** `GET /v1/admin/me`: identity, photo and edition of the name and function. */
export function ProfileView() {
  const { profile, official, administration, setOfficial, loading, error } = useConsole();
  const [name, setName] = useState<string | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoFailure, setPhotoFailure] = useState<string | null>(null);
  const [photoVersion, setPhotoVersion] = useState(0);

  if (error) return <InlineAlert>{error}</InlineAlert>;
  if (!profile || !official) return loading ? <p role="status" className="text-sm text-ink-muted">Chargement…</p> : null;

  const displayName = name ?? official.displayName;
  const jobTitle = job ?? official.jobTitle;
  const dirty = displayName.trim() !== official.displayName || jobTitle.trim() !== official.jobTitle;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!dirty || saving || !displayName.trim() || !jobTitle.trim()) return;
    setSaving(true);
    setFailure(null);
    setSaved(false);
    try {
      setOfficial(await adminApi.updateMe({ displayName: displayName.trim(), jobTitle: jobTitle.trim() }));
      setName(null);
      setJob(null);
      setSaved(true);
    } catch (caught) {
      setFailure(toFailure(caught).message);
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setPhotoFailure(null);
    const type = AVATAR_TYPES.find((candidate) => candidate === file.type);
    if (!type) {
      setPhotoFailure('Format non pris en charge : JPEG ou PNG uniquement.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setPhotoFailure('Image trop volumineuse (2 Mio maximum).');
      return;
    }
    setUploading(true);
    try {
      setOfficial(await adminApi.uploadAvatar(file, type));
      setPhotoVersion((value) => value + 1);
    } catch (caught) {
      setPhotoFailure(toFailure(caught).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Section title="Identité">
        <div className="flex flex-wrap items-center gap-4">
          {official.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photoVersion}
              src={adminApi.avatarUrl(official.id)}
              alt={`Photo de ${official.displayName}`}
              className="size-20 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-20 items-center justify-center rounded-full bg-sunken text-2xl font-bold text-ink-muted"
            >
              {initials(official.displayName)}
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-display text-2xl font-extrabold tracking-[-0.03em]">{official.displayName}</p>
              <StatusPill status={official.role === 'agent' ? 'info' : 'validated'}>{roleLabel(official.role)}</StatusPill>
            </div>
            <p className="text-sm text-ink-muted">{official.jobTitle}</p>
            <p className="text-sm text-ink-muted">{official.email}</p>
            <p className="text-sm text-ink-muted">
              {administration ? administration.name : 'Toutes les administrations'}
            </p>
          </div>
        </div>
      </Section>

      <Section title="Modifier mon profil">
        <form className="flex flex-col gap-4" onSubmit={save}>
          <TextField
            label="Nom affiché"
            required
            maxLength={200}
            value={displayName}
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            label="Fonction"
            required
            maxLength={200}
            value={jobTitle}
            onChange={(event) => setJob(event.target.value)}
          />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!dirty || saving || !displayName.trim() || !jobTitle.trim()}>
              Enregistrer
            </Button>
            {saved ? <span role="status" className="text-sm font-semibold text-trust-text">Profil enregistré.</span> : null}
          </div>
          {failure ? <InlineAlert>{failure}</InlineAlert> : null}
        </form>
      </Section>

      <Section title="Photo">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[15px] font-semibold text-ink">
            Choisir une photo
            <input
              type="file"
              accept="image/jpeg,image/png"
              disabled={uploading}
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                event.target.value = '';
              }}
              className="text-sm font-normal"
            />
          </label>
          <p className="text-[13px] text-ink-muted">JPEG ou PNG, 2 Mio au maximum.</p>
          {uploading ? <p role="status" className="text-sm text-ink-muted">Envoi en cours…</p> : null}
          {photoFailure ? <InlineAlert>{photoFailure}</InlineAlert> : null}
        </div>
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
    </div>
  );
}
