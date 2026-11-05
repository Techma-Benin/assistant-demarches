'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useRef, type ComponentPropsWithoutRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const SIZES = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-2xl' } as const;

export type DialogContentProps = Omit<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  size?: keyof typeof SIZES;
};

/**
 * Modal (focus piégé, Échap, retour du focus) : le titre est obligatoire, c'est le nom accessible de la boîte.
 * Le bouton « Fermer » vient en dernier dans le DOM : le focus s'ouvre sur le premier champ (ou sur « Annuler »).
 */
export function DialogContent({
  title,
  description,
  size = 'md',
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: DialogContentProps) {
  // Une boîte ouverte depuis un état (sans <DialogTrigger>) rend le focus à l'élément qui l'a ouverte.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-dialog-overlay fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        {...(description ? {} : { 'aria-describedby': undefined })}
        onOpenAutoFocus={(event) => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (!event.defaultPrevented && opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus();
          }
        }}
        className={cn(
          'ui-dialog fixed top-1/2 left-1/2 z-50 flex max-h-[min(92dvh,760px)] w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-(--ui-shadow-pop) outline-none',
          SIZES[size],
          className,
        )}
        {...props}
      >
        <div className="px-6 pt-6 pr-14 pb-4">
          <DialogPrimitive.Title className="font-display text-xl leading-tight font-extrabold break-words">
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-1 text-sm text-ink-muted">{description}</DialogPrimitive.Description>
          ) : null}
        </div>
        {children}
        <DialogPrimitive.Close
          aria-label="Fermer"
          className="absolute top-4 right-4 inline-flex size-10 cursor-pointer items-center justify-center rounded-pill text-ink-muted transition-colors duration-(--ui-dur-press) hover:bg-sunken hover:text-ink"
        >
          <X aria-hidden="true" className="size-5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Zone défilante de la boîte. */
export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-2', className)} {...props} />;
}

/** Barre d'actions toujours visible, alignée à droite. */
export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-wrap items-center justify-end gap-3 border-t border-line-subtle bg-shell px-6 py-4', className)}
      {...props}
    />
  );
}
