'use client';

import { cn } from '@techma/ui';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Shared by the administration and operator rails so a resize on one is the expanded width of the other. */
export const RAIL_WIDTH_KEY = 'shell-rail-width';
/** 12.5rem. Expanded rails never go thinner than this; pulling past it collapses. */
export const RAIL_MIN_PX = 200;
/** 20rem. Also capped by 32vw so the rail cannot reach the middle of the screen. */
export const RAIL_MAX_PX = 320;
export const RAIL_COLLAPSED = '4.25rem';
export const RAIL_COLLAPSED_PX = 68;
export const RAIL_STEP_PX = 16;

export function railMaxPx(viewportWidth: number): number {
  return Math.min(RAIL_MAX_PX, Math.round(viewportWidth * 0.32));
}

export function clampExpandedWidth(px: number, viewportWidth: number): number {
  const max = Math.max(railMaxPx(viewportWidth), RAIL_MIN_PX);
  return Math.round(Math.min(Math.max(px, RAIL_MIN_PX), max));
}

export function readStoredRailWidth(): number {
  try {
    const raw = Number(window.localStorage.getItem(RAIL_WIDTH_KEY));
    if (!Number.isFinite(raw) || raw <= 0) return RAIL_MIN_PX;
    return Math.round(Math.min(Math.max(raw, RAIL_MIN_PX), RAIL_MAX_PX));
  } catch {
    return RAIL_MIN_PX;
  }
}

function writeStoredRailWidth(px: number, viewportWidth: number) {
  try {
    window.localStorage.setItem(RAIL_WIDTH_KEY, String(clampExpandedWidth(px, viewportWidth)));
  } catch {
    // Storage unavailable: the width only lasts for this page.
  }
}

export function useSharedRailWidth(collapsed: boolean, commitCollapsed: (next: boolean) => void) {
  const [width, setWidth] = useState(RAIL_MIN_PX);
  const [dragging, setDragging] = useState(false);
  const [max, setMax] = useState(RAIL_MAX_PX);
  const shown = Math.min(width, max);

  useEffect(() => {
    setWidth(readStoredRailWidth());
    setMax(Math.max(railMaxPx(window.innerWidth), RAIL_MIN_PX));
  }, []);

  useEffect(() => {
    const onResize = () => setMax(Math.max(railMaxPx(window.innerWidth), RAIL_MIN_PX));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const applyProposed = useCallback(
    (px: number) => {
      if (px < RAIL_MIN_PX) {
        commitCollapsed(true);
        return;
      }
      const next = clampExpandedWidth(px, window.innerWidth);
      setWidth(next);
      writeStoredRailWidth(next, window.innerWidth);
      commitCollapsed(false);
    },
    [commitCollapsed],
  );

  const nudge = useCallback(
    (direction: -1 | 1) => {
      if (collapsed) {
        if (direction > 0) applyProposed(RAIL_MIN_PX);
        return;
      }
      if (direction > 0 && shown >= max) return;
      applyProposed(shown + direction * RAIL_STEP_PX);
    },
    [applyProposed, collapsed, max, shown],
  );

  return {
    width: shown,
    max,
    dragging,
    setDragging,
    applyProposed,
    nudge,
    column: collapsed ? RAIL_COLLAPSED : `${shown}px`,
  };
}

/** Two short strokes on the rail boundary. Dragging follows the pointer; arrow keys step the width. */
export function RailGrip({
  collapsed,
  width,
  max,
  onProposed,
  onNudge,
  onDraggingChange,
}: {
  collapsed: boolean;
  width: number;
  max: number;
  onProposed: (px: number) => void;
  onNudge: (direction: -1 | 1) => void;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const drag = useRef<{ startX: number; origin: number } | null>(null);

  function endDrag(target: HTMLElement, pointerId: number) {
    if (!drag.current) return;
    drag.current = null;
    onDraggingChange(false);
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      // The pointer was already released.
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = { startX: event.clientX, origin: collapsed ? RAIL_COLLAPSED_PX : width };
    onDraggingChange(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom and some browsers omit capture; the move listener still runs on this node.
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    onProposed(drag.current.origin + (event.clientX - drag.current.startX));
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionner le menu latéral"
      aria-valuemin={RAIL_COLLAPSED_PX}
      aria-valuemax={max}
      aria-valuenow={collapsed ? RAIL_COLLAPSED_PX : width}
      tabIndex={0}
      data-rail-grip=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endDrag(event.currentTarget, event.pointerId)}
      onPointerCancel={(event) => endDrag(event.currentTarget, event.pointerId)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault();
          onNudge(-1);
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault();
          onNudge(1);
        }
      }}
      className="absolute top-1/2 right-0.5 z-30 hidden h-8 w-3 -translate-y-1/2 cursor-col-resize touch-none items-center justify-center md:flex focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <span aria-hidden="true" className="flex h-4 gap-[3px]">
        <span data-rail-stroke="" className="w-px rounded-full bg-ink-muted" />
        <span data-rail-stroke="" className="w-px rounded-full bg-ink-muted" />
      </span>
    </div>
  );
}

export function railFrameClass(dragging: boolean): string {
  return cn(
    'relative min-h-dvh md:grid md:grid-cols-[var(--rail-width)_minmax(0,1fr)]',
    dragging
      ? 'md:transition-none'
      : 'md:transition-[grid-template-columns,--rail-cut-top] md:duration-[220ms] md:ease-(--ui-ease-drawer)',
  );
}

const RAIL_SHADOW_EDGE = {
  left: 'var(--rail-width)',
  boxShadow: 'var(--ui-rail-shadow)',
} as const;

const RAIL_SHADOW_CLASS = 'pointer-events-none absolute z-10 w-px';

/**
 * Shadow of the content over the rail behind it.
 * With a cutout, two segments leave a gap from 17px above the active row to
 * 17px below it (same as the selection notch) so the shadow never crosses the
 * merged canvas plane of the active section.
 */
export function RailEdgeShadow({ cutout }: { cutout: boolean }) {
  if (!cutout) {
    return (
      <div
        aria-hidden="true"
        data-rail-shadow=""
        className={cn(RAIL_SHADOW_CLASS, 'inset-y-0')}
        style={RAIL_SHADOW_EDGE}
      />
    );
  }

  return (
    <>
      <div
        aria-hidden="true"
        data-rail-shadow=""
        data-rail-cutout=""
        className={RAIL_SHADOW_CLASS}
        style={{
          ...RAIL_SHADOW_EDGE,
          top: 0,
          height: 'max(0px, calc(var(--rail-cut-top) - 17px))',
        }}
      />
      <div
        aria-hidden="true"
        data-rail-shadow=""
        data-rail-cutout=""
        className={RAIL_SHADOW_CLASS}
        style={{
          ...RAIL_SHADOW_EDGE,
          top: 'calc(var(--rail-cut-top) + var(--nav-item-height, 0px) + 17px)',
          bottom: 0,
        }}
      />
    </>
  );
}

/** Content sits in front of the rail and shares the canvas plane with the selected row. */
export const RAIL_CONTENT_CLASS = 'relative z-10 min-w-0 w-full bg-canvas px-4 py-6 md:px-8 md:py-8 xl:px-10';
