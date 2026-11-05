'use client';

import { Button, DialogBody, DialogClose, DialogFooter, InlineAlert, TextField } from '@techma/ui';
import { useState, type FormEvent } from 'react';
import { describeError, operatorApi, type McpServer } from '@/lib/operator/api';
import {
  emptyServerForm,
  makeId,
  serverToForm,
  validateServerForm,
  type ServerFormErrors,
  type ServerFormValues,
} from '@/lib/operator/forms';
import { SelectField } from '../ui';

const AUTH_OPTIONS = [
  { value: 'none', label: 'Aucune' },
  { value: 'bearer', label: 'Jeton (variable d’environnement)' },
  { value: 'oauth-client-credentials', label: 'OAuth (identifiants client)' },
] as const;

export const serverFormTitle = (server?: McpServer) => (server ? `Modifier ${server.name}` : 'Ajouter une connexion');

/** Body and footer of the add/edit dialog (the dialog itself provides the title). */
export function ServerForm({
  server,
  existingIds,
  onSaved,
}: {
  /** Absent: creation. */
  server?: McpServer;
  existingIds: readonly string[];
  onSaved: (saved: McpServer) => void;
}) {
  const [values, setValues] = useState<ServerFormValues>(server ? serverToForm(server) : emptyServerForm);
  const [errors, setErrors] = useState<ServerFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof ServerFormValues>(key: K, value: ServerFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const id = server?.id ?? makeId(values.name, existingIds);
    const result = validateServerForm(values, id);
    setErrors(result.errors);
    if (!result.server) return;
    const payload: McpServer = { ...result.server, enabled: server?.enabled ?? true };
    setSaving(true);
    try {
      const saved = server ? await operatorApi.updateServer(payload) : await operatorApi.createServer(payload);
      onSaved(saved);
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setSaving(false);
    }
  }

  const title = serverFormTitle(server);

  return (
    <form onSubmit={submit} noValidate aria-label={title} className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="flex flex-col gap-4 py-3">
        {failure ? <InlineAlert>{failure}</InlineAlert> : null}
        <TextField label="Nom" required value={values.name} error={errors.name} onChange={(e) => set('name', e.target.value)} />
        <TextField
          label="Adresse du serveur"
          required
          type="url"
          inputMode="url"
          autoComplete="off"
          hint="Seules les adresses autorisées par le serveur (MCP_ALLOWED_URLS) sont acceptées."
          value={values.url}
          error={errors.url}
          onChange={(e) => set('url', e.target.value)}
        />
        <SelectField
          label="Authentification"
          value={values.authType}
          options={AUTH_OPTIONS}
          onChange={(e) => set('authType', e.target.value as ServerFormValues['authType'])}
        />
        {values.authType === 'bearer' ? (
          <TextField
            label="Variable du jeton (secretRef)"
            required
            autoComplete="off"
            spellCheck={false}
            hint="Nom de la variable d’environnement qui contient le jeton, jamais le jeton lui-même."
            value={values.secretRef}
            error={errors.secretRef}
            onChange={(e) => set('secretRef', e.target.value)}
          />
        ) : null}
        {values.authType === 'oauth-client-credentials' ? (
          <>
            <TextField
              label="Adresse d’obtention du jeton"
              required
              type="url"
              inputMode="url"
              value={values.tokenUrl}
              error={errors.tokenUrl}
              onChange={(e) => set('tokenUrl', e.target.value)}
            />
            <TextField label="Identifiant client" required value={values.clientId} error={errors.clientId} onChange={(e) => set('clientId', e.target.value)} />
            <TextField
              label="Variable du secret client (clientSecretRef)"
              required
              autoComplete="off"
              spellCheck={false}
              hint="Nom de la variable d’environnement qui contient le secret, jamais le secret lui-même."
              value={values.clientSecretRef}
              error={errors.clientSecretRef}
              onChange={(e) => set('clientSecretRef', e.target.value)}
            />
            <TextField label="Portée (facultatif)" value={values.scope} onChange={(e) => set('scope', e.target.value)} />
          </>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Annuler</Button>
        </DialogClose>
        <Button type="submit" disabled={saving}>
          {saving ? (server ? 'Enregistrement…' : 'Ajout…') : server ? 'Enregistrer' : 'Ajouter'}
        </Button>
      </DialogFooter>
    </form>
  );
}
