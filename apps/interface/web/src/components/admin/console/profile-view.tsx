'use client';

import { Badge, Button, InlineAlert, TextField } from '@techma/ui';
import { Camera } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Dialog } from '@/components/admin/dialog';
import { adminApi } from '@/lib/admin/api';
import { toFailure } from '@/lib/admin/errors';
import { roleLabel } from '@/lib/admin/permissions';
import { useConsole } from './console-context';

/** Photo limit from `PUT /v1/admin/me/avatar`: 2 Mio, JPEG or PNG. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png'] as const;
const PHOTO_HINT = 'JPEG ou PNG, 2 Mio au maximum.';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/** `GET /v1/admin/me`: identity card, photo and edition of the display name. */
export function ProfileView() {
  const { profile, official, setOfficial, loading, error } = useConsole();
  const photoHintId = useId();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoFailure, setPhotoFailure] = useState<string | null>(null);
  const [photoVersion, setPhotoVersion] = useState(0);

  if (error) return <InlineAlert>{error}</InlineAlert>;
  if (!profile || !official) return loading ? <p role="status" className="text-sm text-ink-muted">Chargement…</p> : null;

  const currentOfficial = official;
  const displayName = name ?? official.displayName;
  const dirty = displayName.trim() !== official.displayName;

  function openEditor() {
    setName(currentOfficial.displayName);
    setFailure(null);
    setSaved(false);
    setEditing(true);
  }

  function closeEditor() {
    if (saving) return;
    setEditing(false);
    setName(null);
    setFailure(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!dirty || saving || !displayName.trim()) return;
    setSaving(true);
    setFailure(null);
    setSaved(false);
    try {
      setOfficial(await adminApi.updateMe({ displayName: displayName.trim(), jobTitle: currentOfficial.jobTitle }));
      setName(null);
      setEditing(false);
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
    <section className="w-full rounded-card border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <label
          title={PHOTO_HINT}
          className="group relative block size-28 shrink-0 cursor-pointer overflow-hidden rounded-card bg-sunken"
        >
          {official.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photoVersion}
              src={adminApi.avatarUrl(official.id)}
              alt={`Photo de ${official.displayName}`}
              className="size-full object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-full items-center justify-center text-2xl font-bold text-ink-muted"
            >
              {initials(official.displayName)}
            </span>
          )}
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-ink/80 py-1.5 text-xs font-semibold text-surface">
            <Camera aria-hidden="true" className="size-3.5" />
            Photo
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png"
            aria-label="Choisir une photo"
            aria-describedby={photoHintId}
            disabled={uploading}
            onChange={(event) => {
              void upload(event.target.files?.[0]);
              event.target.value = '';
            }}
            className="sr-only"
          />
        </label>
        <span id={photoHintId} className="sr-only">
          {PHOTO_HINT}
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-display text-3xl font-extrabold tracking-[-0.03em] text-ink">{official.displayName}</p>
            <Badge tone="trust">{roleLabel(official.role)}</Badge>
          </div>
          <p className="text-sm text-ink-muted">{official.email}</p>
        </div>

        <Button variant="outline" size="sm" className="self-start sm:self-center" onClick={openEditor}>
          Modifier
        </Button>
      </div>

      {uploading ? <p role="status" className="mt-4 text-sm text-ink-muted">Envoi en cours…</p> : null}
      {photoFailure ? <div className="mt-4"><InlineAlert>{photoFailure}</InlineAlert></div> : null}
      {saved ? <p role="status" className="mt-4 text-sm font-semibold text-trust-text">Profil enregistré.</p> : null}

      {editing ? (
        <Dialog title="Modifier le nom affiché" onClose={closeEditor}>
          <form className="flex flex-col gap-4" onSubmit={save}>
            <TextField
              label="Nom affiché"
              required
              maxLength={200}
              value={displayName}
              onChange={(event) => setName(event.target.value)}
            />
            {failure ? <InlineAlert>{failure}</InlineAlert> : null}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={closeEditor} disabled={saving}>
                Annuler
              </Button>
              <Button type="submit" disabled={!dirty || saving || !displayName.trim()}>
                Enregistrer
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </section>
  );
}
