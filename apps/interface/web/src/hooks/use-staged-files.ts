'use client';

import { useState } from 'react';
import { validateFile } from '@/lib/files';

export const MAX_STAGED_FILES = 5;

export const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

/** Files staged before one send: validated, deduplicated, capped at MAX_STAGED_FILES. */
export function useStagedFiles(accepted: readonly string[]) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  function add(incoming: File[]) {
    if (incoming.length === 0) return;
    const problems: string[] = [];
    const next = [...files];
    const keys = new Set(next.map(fileKey));
    let overflow = false;
    for (const file of incoming) {
      const result = validateFile(file, accepted);
      if (!result.ok) {
        problems.push(`${file.name} : ${result.error.charAt(0).toLowerCase()}${result.error.slice(1)}`);
        continue;
      }
      if (keys.has(fileKey(file))) continue;
      if (next.length >= MAX_STAGED_FILES) {
        overflow = true;
        continue;
      }
      keys.add(fileKey(file));
      next.push(file);
    }
    if (overflow) problems.push(`${MAX_STAGED_FILES} pièces maximum par envoi`);
    setError(problems.length > 0 ? problems.join(' ') : null);
    setFiles(next);
  }

  return {
    files,
    error,
    add,
    remove: (file: File) => setFiles((current) => current.filter((f) => f !== file)),
    clear: () => {
      setFiles([]);
      setError(null);
    },
  };
}
