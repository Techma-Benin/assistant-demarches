'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Remote<T> {
  data: T | null;
  status: 'loading' | 'idle' | 'error';
  error: unknown;
  reload: () => void;
  /** Replaces the loaded value (after a mutation). */
  setData: (data: T) => void;
}

/** One-shot loader; `load` must be stable (useCallback) as a change reloads. */
export function useRemote<T>(load: () => Promise<T>): Remote<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<Remote<T>['status']>('loading');
  const [error, setError] = useState<unknown>(null);
  const generation = useRef(0);

  const run = useCallback(async () => {
    const current = ++generation.current;
    setStatus('loading');
    try {
      const value = await load();
      if (current !== generation.current) return;
      setData(value);
      setStatus('idle');
    } catch (caught) {
      if (current !== generation.current) return;
      setError(caught);
      setStatus('error');
    }
  }, [load]);

  useEffect(() => {
    void run();
    return () => {
      generation.current += 1;
    };
  }, [run]);

  const reload = useCallback(() => void run(), [run]);
  const replace = useCallback((value: T) => {
    generation.current += 1;
    setData(value);
    setStatus('idle');
  }, []);

  return { data, status, error, reload, setData: replace };
}
