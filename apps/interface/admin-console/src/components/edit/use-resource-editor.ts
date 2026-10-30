'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C3Error } from '@/lib/c3-client';
import { toSaveFailure } from '@/lib/error-messages';

export interface EditorConfig<T, D> {
  /** Prefix of the Idempotency-Key, e.g. `model-demo`. */
  keyPrefix: string;
  /** Resolves with the resource, or null when it does not exist (anymore). */
  load: () => Promise<T | null>;
  /** Full replacement (PUT) of the resource. */
  save: (value: T, idempotencyKey: string) => Promise<T>;
  toDraft: (resource: T) => D;
  toResource: (draft: D, base: T) => T;
  /** Field name -> message; empty when valid. */
  validate: (draft: D) => Partial<Record<keyof D, string>>;
}

export type LoadStatus = 'loading' | 'ready' | 'missing' | 'error';

export type SaveResult = { kind: 'saved' } | { kind: 'failed'; message: string; conflict: boolean };

export function useResourceEditor<T, D>(config: EditorConfig<T, D>) {
  // Latest config without re-triggering the load effect on every render.
  const configRef = useRef(config);
  configRef.current = config;

  const [base, setBase] = useState<T | null>(null);
  const [draft, setDraft] = useState<D | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  // Key of the last submitted form state; reused only while that state is unchanged and retryable.
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    attempt.current = null;
    configRef.current
      .load()
      .then((resource) => {
        if (cancelled) return;
        if (resource === null) {
          setStatus('missing');
          return;
        }
        setBase(resource);
        setDraft(configRef.current.toDraft(resource));
        setResult(null);
        setStatus('ready');
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(
          caught instanceof C3Error && (caught.status === 401 || caught.status === 403)
            ? 'Accès administrateur requis'
            : 'Impossible de charger la ressource.',
        );
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const baselineSignature = useMemo(
    () => (base === null ? '' : JSON.stringify(configRef.current.toDraft(base))),
    [base],
  );
  const dirty = draft !== null && JSON.stringify(draft) !== baselineSignature;
  const errors = useMemo(
    () => (draft === null ? {} : configRef.current.validate(draft)),
    [draft],
  ) as Partial<Record<keyof D, string>>;
  const valid = Object.keys(errors).length === 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = useCallback((patch: Partial<D>) => {
    setDraft((previous) => (previous === null ? previous : { ...previous, ...patch }));
    setResult(null);
  }, []);

  const reset = useCallback(() => {
    if (base === null) return;
    setDraft(configRef.current.toDraft(base));
    setResult(null);
  }, [base]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  /**
   * PUTs the draft. `patch` is applied on top of it for this save only (e.g. the validation status of
   * « Valider et publier »): it reaches the draft only once the server accepted it. Resolves true on success.
   */
  const save = useCallback(
    async (patch?: Partial<D>): Promise<boolean> => {
      if (base === null || draft === null || savingRef.current) return false;
      const { keyPrefix, toResource, toDraft, save: put, validate } = configRef.current;
      const next = patch ? { ...draft, ...patch } : draft;
      const signature = JSON.stringify(next);
      if (Object.keys(validate(next)).length > 0 || signature === baselineSignature) return false;
      if (attempt.current?.signature !== signature) {
        attempt.current = { signature, key: `${keyPrefix}-${crypto.randomUUID()}` };
      }
      savingRef.current = true;
      setSaving(true);
      setResult(null);
      try {
        const saved = await put(toResource(next, base), attempt.current.key);
        attempt.current = null;
        setBase(saved);
        setDraft(toDraft(saved));
        setResult({ kind: 'saved' });
        return true;
      } catch (caught) {
        const failure = toSaveFailure(caught);
        if (!failure.retryable) attempt.current = null;
        setResult({ kind: 'failed', message: failure.message, conflict: failure.conflict });
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [base, draft, baselineSignature],
  );

  return {
    status,
    loadError,
    base,
    draft,
    errors,
    dirty,
    valid,
    saving,
    result,
    canSave: valid && dirty && !saving,
    update,
    reset,
    reload,
    save,
  };
}

export type ResourceEditor<T, D> = ReturnType<typeof useResourceEditor<T, D>>;
