'use client';

import { Button, Dialog, DialogClose, DialogContent, DialogFooter } from '@techma/ui';
import type { ReactNode } from 'react';

/** Confirmation of a definitive deletion. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" title={title} description={description}>
        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button variant="outline">Annuler</Button>
          </DialogClose>
          <Button
            disabled={busy}
            onClick={onConfirm}
            className="bg-flag-red text-white hover:bg-flag-red hover:brightness-90"
          >
            Confirmer la suppression
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
