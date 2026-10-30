'use client';

import { Button, StatusPill, TextArea, TextField, Tile, Toast } from '@techma/ui';
import { Check, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { c3, type Procedure } from '@/lib/c3-client';
import { findInPages } from '@/lib/find-resource';
import { canSeeProcedure } from '@/lib/visible-procedures';
import { isStaleSource, STALE_AFTER_DAYS } from '@/lib/procedure-list';
import {
  toProcedure,
  toProcedureDraft,
  validateProcedure,
  type ProcedureDraft,
} from '@/lib/procedure-form';
import { EditForm, ReadOnlyField } from './edit/edit-form';
import { useResourceEditor, type ResourceEditor } from './edit/use-resource-editor';
import { FormSchemaSection } from './procedures/form-schema-section';
import { RequiredDocuments } from './procedures/required-documents';
import { UserPreview } from './procedures/user-preview';
import { ReadOnlyNote } from './session/read-only-note';
import { AccessDenied } from './session/require-capability';
import { useSession } from './session/session-context';
import { useToast } from './use-toast';

type Editor = ResourceEditor<Procedure, ProcedureDraft>;

const SAVED = 'Fiche enregistrée';
const PUBLISHED = 'Fiche validée - l’assistant peut la citer';
const UNPUBLISHED = 'Fiche repassée en brouillon';

export function ProcedureEdit({ id, now }: { id: string; now?: Date }) {
  const editor: Editor = useResourceEditor<Procedure, ProcedureDraft>({
    keyPrefix: `procedure-${id}`,
    load: () => findInPages((params) => c3.listProcedures(params), (procedure) => procedure.id === id),
    save: (procedure, key) => c3.updateProcedure(procedure, key),
    toDraft: toProcedureDraft,
    toResource: toProcedure,
    validate: validateProcedure,
  });
  const { errors, update } = editor;
  const toast = useToast();
  const { identity, can } = useSession();
  const readOnly = !can('procedures.edit');
  const [reference] = useState(() => now ?? new Date());

  // One PUT per intent (a fresh Idempotency-Key each time): the status change travels with the pending edits.
  const run = async (patch: Partial<ProcedureDraft> | undefined, message: string) => {
    if (await editor.save(patch)) toast.show(message);
  };

  // Defence in depth: the Backend does not return other administrations' fiches.
  if (editor.base !== null && !canSeeProcedure(identity, editor.base)) {
    const owner = editor.base.administrationId;
    return (
      <AccessDenied
        capability="procedures.view"
        accepts={(candidate) => candidate.kind === 'platform' || candidate.administrationId === owner}
      />
    );
  }

  return (
    <EditForm
      editor={editor}
      title={(procedure) => procedure.title}
      fallbackTitle={id}
      backHref="/procedures"
      backLabel="Retour aux fiches de démarche"
      onSubmit={() => !readOnly && void run(undefined, SAVED)}
      headerActions={<Toast message={toast.message} onDismiss={toast.dismiss} />}
      aside={(draft) => <UserPreview draft={draft} />}
      actionsNote={
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold">{`Vous agissez en tant que : ${identity?.label ?? ''}`}</p>
          {readOnly ? <ReadOnlyNote /> : null}
        </div>
      }
      actions={({ base, draft, saving, canSave, valid, dirty, reset }) => (
        <>
          <Button type="submit" variant="outline" className="min-w-40" disabled={readOnly || !canSave}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
          {draft?.validationStatus === 'draft' ? (
            <Button
              variant="trust"
              leadingIcon={<Check aria-hidden="true" className="size-4" />}
              disabled={readOnly || !valid || saving}
              onClick={() => void run({ validationStatus: 'validated' }, PUBLISHED)}
            >
              Valider et publier
            </Button>
          ) : null}
          {base?.validationStatus === 'validated' ? (
            <Button
              variant="secondary"
              disabled={readOnly || !valid || saving}
              onClick={() => void run({ validationStatus: 'draft' }, UNPUBLISHED)}
            >
              Repasser en brouillon
            </Button>
          ) : null}
          <Button variant="ghost" disabled={readOnly || !dirty || saving} onClick={reset}>
            Annuler les modifications
          </Button>
        </>
      )}
    >
      {(draft, { base }) => (
        <Tile tone="outline" className="flex flex-col gap-5 p-6 md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-mono text-[13px] break-all text-ink-subtle">{id}</span>
              <span className="text-sm text-ink-muted">Administration : {base?.administrationId}</span>
            </div>
            <StatusPill status={draft.validationStatus === 'validated' ? 'validated' : 'draft'} className="text-[13px] font-extrabold">
              {draft.validationStatus === 'validated' ? 'Validée' : 'Brouillon'}
            </StatusPill>
          </div>

          {base && isStaleSource(base.source.retrievedAt, reference) ? (
            <div
              role="note"
              className="flex items-start gap-2.5 rounded-2xl bg-danger-soft px-4 py-3.5 text-sm leading-snug font-semibold text-danger"
            >
              <TriangleAlert aria-hidden="true" className="mt-px size-[18px] shrink-0" />
              Source consultée il y a plus de {STALE_AFTER_DAYS} jours. Revérifiez le portail officiel avant de republier.
            </div>
          ) : null}

          <TextField
            label="Titre"
            required
            value={draft.title}
            error={errors.title}
            readOnly={readOnly}
            onChange={(event) => update({ title: event.target.value })}
          />
          <TextArea
            label="Résumé lu par l’assistant"
            required
            rows={4}
            value={draft.summary}
            error={errors.summary}
            readOnly={readOnly}
            onChange={(event) => update({ summary: event.target.value })}
          />
          <RequiredDocuments
            documents={draft.requiredDocuments}
            error={errors.requiredDocuments}
            readOnly={readOnly}
            onChange={(requiredDocuments) => update({ requiredDocuments })}
          />
          <div className="flex flex-wrap gap-4">
            <div className="min-w-0 flex-[1_1_180px]">
              <TextField
                label="Frais (FCFA)"
                hint="Entier supérieur ou égal à 0 ; 0 pour une démarche gratuite."
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                required
                value={draft.feeFcfa}
                error={errors.feeFcfa}
                readOnly={readOnly}
                onChange={(event) => update({ feeFcfa: event.target.value })}
              />
            </div>
            <div className="min-w-0 flex-[1_1_180px]">
              <TextField
                label="Délai de traitement (jours)"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                required
                value={draft.processingDays}
                error={errors.processingDays}
                readOnly={readOnly}
                onChange={(event) => update({ processingDays: event.target.value })}
              />
            </div>
          </div>

          <fieldset className="flex min-w-0 flex-col gap-4 rounded-card border border-line p-5">
            <legend className="px-1.5 text-[15px] font-bold">Source officielle</legend>
            <ReadOnlyField label="Identifiant de la démarche source" value={base?.source.procedureId ?? ''} />
            <TextField
              label="URL de la fiche"
              type="url"
              required
              className="font-mono text-sm"
              value={draft.sourceUrl}
              error={errors.sourceUrl}
              readOnly={readOnly}
              onChange={(event) => update({ sourceUrl: event.target.value })}
            />
            <div className="flex flex-wrap gap-4">
              <div className="min-w-0 flex-[1_1_140px]">
                <TextField
                  label="Version"
                  required
                  value={draft.sourceVersion}
                  error={errors.sourceVersion}
                  readOnly={readOnly}
                  onChange={(event) => update({ sourceVersion: event.target.value })}
                />
              </div>
              <div className="min-w-0 flex-[1_1_200px]">
                <TextField
                  label="Consultée le"
                  type="datetime-local"
                  required
                  value={draft.retrievedAt}
                  error={errors.retrievedAt}
                  readOnly={readOnly}
                  onChange={(event) => update({ retrievedAt: event.target.value })}
                />
              </div>
            </div>
          </fieldset>

          <FormSchemaSection
            text={draft.formSchemaText}
            error={errors.formSchemaText}
            readOnly={readOnly}
            onChange={(formSchemaText) => update({ formSchemaText })}
          />
        </Tile>
      )}
    </EditForm>
  );
}
