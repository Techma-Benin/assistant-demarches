'use client';

import {
  Badge,
  Button,
  Card,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextArea,
  TextField,
} from '@techma/ui';
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { c3, type Procedure } from '@/lib/c3-client';
import { findInPages } from '@/lib/find-resource';
import {
  describeFormSchema,
  parseFormSchema,
  toProcedure,
  toProcedureDraft,
  validateProcedure,
  type ProcedureDraft,
} from '@/lib/procedure-form';
import { EditForm, FormSection, ReadOnlyField } from './edit/edit-form';
import { useResourceEditor, type ResourceEditor } from './edit/use-resource-editor';

type Editor = ResourceEditor<Procedure, ProcedureDraft>;

export function ProcedureEdit({ id }: { id: string }) {
  const editor: Editor = useResourceEditor<Procedure, ProcedureDraft>({
    keyPrefix: `procedure-${id}`,
    load: () => findInPages((params) => c3.listProcedures(params), (procedure) => procedure.id === id),
    save: (procedure, key) => c3.updateProcedure(procedure, key),
    toDraft: toProcedureDraft,
    toResource: toProcedure,
    validate: validateProcedure,
  });
  const { errors, update } = editor;

  return (
    <EditForm
      editor={editor}
      title={(procedure) => procedure.title}
      fallbackTitle={id}
      backHref="/procedures"
      backLabel="Retour aux fiches de démarche"
    >
      {(draft, { base }) => (
        <>
          <FormSection title="Général">
            <TextField
              label="Titre"
              required
              value={draft.title}
              error={errors.title}
              onChange={(event) => update({ title: event.target.value })}
            />
            <ReadOnlyField label="Administration" value={base?.administrationId ?? ''} />
            <TextArea
              label="Résumé"
              required
              rows={4}
              value={draft.summary}
              error={errors.summary}
              onChange={(event) => update({ summary: event.target.value })}
            />
          </FormSection>

          <FormSection title="Pièces requises">
            <RequiredDocuments
              documents={draft.requiredDocuments}
              error={errors.requiredDocuments}
              onChange={(requiredDocuments) => update({ requiredDocuments })}
            />
          </FormSection>

          <FormSection title="Frais et délai">
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
              onChange={(event) => update({ feeFcfa: event.target.value })}
            />
            <TextField
              label="Délai de traitement (jours)"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              required
              value={draft.processingDays}
              error={errors.processingDays}
              onChange={(event) => update({ processingDays: event.target.value })}
            />
          </FormSection>

          <FormSection title="Source">
            <ReadOnlyField label="Identifiant de la démarche source" value={base?.source.procedureId ?? ''} />
            <TextField
              label="Adresse (URL)"
              type="url"
              required
              value={draft.sourceUrl}
              error={errors.sourceUrl}
              onChange={(event) => update({ sourceUrl: event.target.value })}
            />
            <TextField
              label="Version"
              required
              value={draft.sourceVersion}
              error={errors.sourceVersion}
              onChange={(event) => update({ sourceVersion: event.target.value })}
            />
            <TextField
              label="Récupérée le"
              type="datetime-local"
              required
              value={draft.retrievedAt}
              error={errors.retrievedAt}
              onChange={(event) => update({ retrievedAt: event.target.value })}
            />
          </FormSection>

          <FormSection title="Validation">
            <ValidationControl
              status={draft.validationStatus}
              onChange={(validationStatus) => update({ validationStatus })}
            />
          </FormSection>

          <FormSection title="Formulaire de la démarche">
            <TextArea
              label="Schéma du formulaire (JSON)"
              hint="Objet JSON décrivant les champs demandés à l’usager."
              rows={12}
              spellCheck={false}
              className="font-mono text-[13px]"
              value={draft.formSchemaText}
              error={errors.formSchemaText}
              onChange={(event) => update({ formSchemaText: event.target.value })}
            />
            <FormSchemaPreview text={draft.formSchemaText} />
          </FormSection>
        </>
      )}
    </EditForm>
  );
}

function RequiredDocuments({
  documents,
  error,
  onChange,
}: {
  documents: string[];
  error?: string;
  onChange: (documents: string[]) => void;
}) {
  const [entry, setEntry] = useState('');
  const value = entry.trim();
  const duplicate = value !== '' && documents.some((item) => item.trim() === value);

  const add = () => {
    if (value === '' || duplicate) return;
    onChange([...documents, value]);
    setEntry('');
  };

  return (
    <div className="flex flex-col gap-3">
      {documents.length === 0 ? (
        <p className="text-sm text-ink-muted">Aucune pièce requise.</p>
      ) : (
        <ul aria-label="Pièces requises" className="flex flex-col gap-2">
          {documents.map((item) => (
            <li key={item} className="flex items-center justify-between gap-2 rounded-field border border-line px-4">
              <span className="py-2">{item}</span>
              <IconButton label={`Retirer ${item}`} onClick={() => onChange(documents.filter((d) => d !== item))}>
                <X aria-hidden="true" className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="text-[13px] font-semibold text-danger">{error}</p> : null}
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <TextField
            label="Ajouter une pièce"
            value={entry}
            error={duplicate ? 'Cette pièce figure déjà dans la liste.' : undefined}
            onChange={(event) => setEntry(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
          />
        </div>
        <Button variant="secondary" disabled={value === '' || duplicate} onClick={add}>
          Ajouter
        </Button>
      </div>
    </div>
  );
}

function ValidationControl({
  status,
  onChange,
}: {
  status: ProcedureDraft['validationStatus'];
  onChange: (status: ProcedureDraft['validationStatus']) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const validated = status === 'validated';
  const target = validated ? 'draft' : 'validated';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {validated ? <Badge tone="trust">Validée</Badge> : <Badge>Brouillon</Badge>}
        {!confirming ? (
          <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
            {validated ? 'Repasser en brouillon' : 'Marquer comme validée'}
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <Card role="group" aria-label="Confirmation" className="flex flex-col gap-3">
          <p className="text-sm">
            {validated
              ? 'Repasser en brouillon retire cette fiche de ce qui est montré aux usagers en production.'
              : 'Valider cette fiche signifie qu’elle peut être montrée aux usagers en production. Vérifiez son contenu avant de confirmer.'}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              size="sm"
              onClick={() => {
                onChange(target);
                setConfirming(false);
              }}
            >
              Confirmer
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
              Annuler
            </Button>
          </div>
        </Card>
      ) : null}
      <p className="text-[13px] text-ink-muted">Le changement est appliqué avec le reste, à l’enregistrement.</p>
    </div>
  );
}

function FormSchemaPreview({ text }: { text: string }) {
  const properties = useMemo(() => {
    const parsed = parseFormSchema(text);
    return parsed.ok ? describeFormSchema(parsed.value) : null;
  }, [text]);

  if (properties === null) return null;
  if (properties.length === 0) return <p className="text-sm text-ink-muted">Aucune propriété déclarée.</p>;
  return (
    <Table aria-label="Aperçu du formulaire">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Champ</TableHeaderCell>
          <TableHeaderCell>Type</TableHeaderCell>
          <TableHeaderCell>Obligatoire</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {properties.map((property) => (
          <TableRow key={property.name}>
            <TableCell className="font-mono text-[13px]">{property.name}</TableCell>
            <TableCell>{property.type}</TableCell>
            <TableCell>{property.required ? 'Oui' : 'Non'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
