'use client';

import { Button, InlineAlert } from '@techma/ui';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '@/components/admin/dialog';

/**
 * Shows the temporary password of a new official. The Backend returns it once: closing the dialog
 * drops it from the page, and it is never logged.
 */
export function PasswordDialog({
  displayName,
  password,
  onClose,
}: {
  displayName: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title="Compte créé" onClose={onClose} dismissible={false}>
      <p>
        Le compte de <strong>{displayName}</strong> est créé. Transmettez-lui ce mot de passe temporaire ; il devra le
        changer à sa première connexion.
      </p>
      <div className="flex items-center gap-3 rounded-field border border-field bg-sunken px-4 py-3">
        <code aria-label="Mot de passe temporaire" className="min-w-0 flex-1 font-mono text-base break-all">
          {password}
        </code>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(password).then(() => setCopied(true));
          }}
        >
          {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
          {copied ? 'Copié' : 'Copier'}
        </Button>
      </div>
      <InlineAlert>Ce mot de passe ne sera plus affiché. Copiez-le avant de fermer cette fenêtre.</InlineAlert>
      <div className="flex justify-end">
        <Button onClick={onClose}>J’ai copié le mot de passe</Button>
      </div>
    </Dialog>
  );
}
