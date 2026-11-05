'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../cn';

export type TooltipProps = {
  label: ReactNode;
  /** Un seul élément focalisable : il reçoit l'info-bulle au survol (après 350 ms) et au focus clavier. */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
};

/** Info-bulle de survol. Elle complète le nom accessible du bouton, elle ne le remplace pas. */
export function Tooltip({ label, children, side = 'top', className }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className={cn(
              'ui-tooltip z-[60] rounded-lg bg-action px-2.5 py-1.5 text-[13px] leading-none font-semibold text-on-action shadow-(--ui-shadow-pop)',
              className,
            )}
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
