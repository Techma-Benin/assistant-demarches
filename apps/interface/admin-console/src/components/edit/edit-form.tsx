'use client';

import { Button, Card, InlineAlert, cn } from '@techma/ui';
import { Check } from 'lucide-react';
import Link from 'next/link';
import type { FormEvent, ReactNode } from 'react';
import { PageHeader } from '../page-header';
import type { ResourceEditor } from './use-resource-editor';

export interface EditFormProps<T, D> {
  editor: ResourceEditor<T, D>;
  /** Page title once loaded (the resource name); `fallbackTitle` before. */
  title: (resource: T) => string;
  fallbackTitle: string;
  backHref: string;
  backLabel: string;
  children: (draft: D, editor: ResourceEditor<T, D>) => ReactNode;
}

export function EditForm<T, D>({ editor, title, fallbackTitle, backHref, backLabel, children }: EditFormProps<T, D>) {
  const { status, base, draft, result, saving, dirty, canSave } = editor;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void editor.save();
  };

  return (
    <>
      <Link href={backHref} className="mb-4 inline-flex min-h-9 items-center text-sm font-semibold underline">
        {`← ${backLabel}`}
      </Link>
      <PageHeader title={base !== null ? title(base) : fallbackTitle} />

      {status === 'loading' ? (
        <p role="status" className="text-sm text-ink-muted">
          Chargement…
        </p>
      ) : null}

      {status === 'missing' ? <InlineAlert>Cette ressource n’existe plus.</InlineAlert> : null}

      {status === 'error' ? (
        <div className="flex flex-wrap items-center gap-3">
          <InlineAlert>{editor.loadError}</InlineAlert>
          <Button variant="secondary" size="sm" onClick={editor.reload}>
            Réessayer
          </Button>
        </div>
      ) : null}

      {status === 'ready' && base !== null && draft !== null ? (
        <form noValidate onSubmit={submit} className="flex max-w-3xl flex-col gap-6">
          {children(draft, editor)}

          {result?.kind === 'failed' ? (
            <div className="flex flex-wrap items-center gap-3">
              <InlineAlert>{result.message}</InlineAlert>
              {result.conflict ? (
                <Button variant="secondary" size="sm" onClick={editor.reload}>
                  Recharger
                </Button>
              ) : null}
            </div>
          ) : null}
          {result?.kind === 'saved' ? (
            <p role="status" className="ui-rise flex items-center gap-2 text-sm font-semibold">
              <Check aria-hidden="true" className="ui-draw size-4 shrink-0" />
              Modifications enregistrées.
            </p>
          ) : null}

          <div
            className={cn(
              'sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border-t border-line bg-surface px-4 py-3 transition-shadow duration-(--ui-dur-base) ease-(--ui-ease-out)',
              dirty && 'shadow-(--ui-shadow-pop)',
            )}
          >
            <p
              key={dirty ? 'dirty' : 'clean'}
              className={cn(
                'ui-swap flex items-center gap-2 text-sm',
                dirty ? 'font-semibold text-ink' : 'text-ink-muted',
              )}
            >
              {dirty ? <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-warning" /> : null}
              {dirty ? 'Modifications non enregistrées' : 'Aucune modification'}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" className="min-w-40" disabled={!canSave}>
                <span key={saving ? 'saving' : 'idle'} className="ui-swap">
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </span>
              </Button>
              <Button variant="secondary" disabled={!dirty || saving} onClick={editor.reset}>
                Annuler les modifications
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </>
  );
}

/** Titled group of fields. */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-base font-extrabold">{title}</h2>
      {children}
    </Card>
  );
}

/** Read-only value shown with a label (identifiers that must not change). */
export function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[15px] font-semibold">{label}</span>
      <span className="min-h-11 rounded-field border border-line bg-sunken px-4 py-2.5 font-mono text-[13px] break-all">
        {value}
      </span>
    </div>
  );
}
