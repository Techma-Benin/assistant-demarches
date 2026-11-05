'use client';

import { cn } from '@techma/ui';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

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
        <span data-rail-stroke="" className="w-px rounded-full bg-field" />
        <span data-rail-stroke="" className="w-px rounded-full bg-field" />
      </span>
    </div>
  );
}

/**
 * Shared by both rails.
 * Collapsed: the mark stays visible and the unfold icon replaces it only while this control is hovered or keyboard-focused.
 * Expanded: the fold icon stays on the right of the header.
 */
export function RailCollapseControl({
  collapsed,
  onToggle,
  mark,
}: {
  collapsed: boolean;
  onToggle: () => void;
  mark: ReactNode;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        aria-label="Déplier le menu latéral"
        className="group hidden size-9 shrink-0 cursor-pointer place-items-center rounded-none text-ink-muted transition-colors duration-(--ui-dur-press) hover:bg-sunken hover:text-ink focus-visible:bg-sunken focus-visible:text-ink md:grid"
      >
        <span className="col-start-1 row-start-1 transition-opacity duration-(--ui-dur-press) group-hover:opacity-0 group-focus-visible:opacity-0 motion-reduce:transition-none">
          {mark}
        </span>
        <ChevronsRight
          aria-hidden="true"
          strokeWidth={2}
          className="col-start-1 row-start-1 size-4 opacity-0 transition-opacity duration-(--ui-dur-press) group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded
      aria-label="Replier le menu latéral"
      className="hidden size-9 shrink-0 cursor-pointer items-center justify-center rounded-none text-ink-muted transition-colors duration-(--ui-dur-press) hover:bg-sunken hover:text-ink md:inline-flex"
    >
      <ChevronsLeft aria-hidden="true" className="size-4" strokeWidth={2} />
    </button>
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

/** Sits on the rail only. Inset keeps the shadow inside this box, off the page. */
const RAIL_SHADOW_BOX = {
  left: 0,
  width: 'var(--rail-width)',
} as const;

const RAIL_SHADOW_CLASS = 'pointer-events-none absolute z-0 hidden md:block';

/** Quiet inset along the rail edge shared with the page. */
const RAIL_EDGE_SHADOW = 'inset var(--ui-rail-shadow)';

/** Same radius as the content card. The two cutout corners use this fillet. */
const RAIL_JOIN_RADIUS = 'var(--ui-radius-card)';

/**
 * Inset shadow on the rail, along the edge it shares with the page.
 * The selected row is a gap: that row and the page are one plane, so no shadow
 * crosses them. The same shadow turns along the top and bottom of the gap and
 * falls onto the rail above and below the selected row. Those two turns are
 * concave fillets, so the shadow follows the curve instead of a square cut.
 */
export function RailEdgeShadow({ cutout }: { cutout: boolean }) {
  if (!cutout) {
    return (
      <div
        aria-hidden="true"
        data-rail-shadow=""
        className={cn(RAIL_SHADOW_CLASS, 'inset-y-0')}
        style={{ ...RAIL_SHADOW_BOX, boxShadow: RAIL_EDGE_SHADOW }}
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
          ...RAIL_SHADOW_BOX,
          top: 0,
          height: 'var(--rail-cut-top)',
          borderBottomRightRadius: RAIL_JOIN_RADIUS,
          boxShadow: `${RAIL_EDGE_SHADOW}, inset var(--ui-rail-lip-above)`,
        }}
      />
      <div
        aria-hidden="true"
        data-rail-shadow=""
        data-rail-cutout=""
        className={RAIL_SHADOW_CLASS}
        style={{
          ...RAIL_SHADOW_BOX,
          top: 'calc(var(--rail-cut-top) + var(--nav-item-height, 0px))',
          bottom: 0,
          borderTopRightRadius: RAIL_JOIN_RADIUS,
          boxShadow: `${RAIL_EDGE_SHADOW}, inset var(--ui-rail-lip-below)`,
        }}
      />
    </>
  );
}

/**
 * Selected row and page are one canvas. The rail scoops around that hole:
 * a card-radius fillet at the top and bottom corners on the content edge.
 */
export function NavActiveNotch() {
  const plate = { width: RAIL_JOIN_RADIUS, height: `calc(${RAIL_JOIN_RADIUS} + 1px)` };
  const fillet = { width: RAIL_JOIN_RADIUS, height: RAIL_JOIN_RADIUS };
  return (
    <>
      <span className="absolute inset-0 rounded-none bg-canvas" />
      <span data-nav-active-bar="" className="absolute inset-y-0 left-0 w-0.5 rounded-none bg-ink-subtle" />
      <span data-nav-corner="top" className="absolute right-0 bottom-[calc(100%-1px)] bg-canvas" style={plate}>
        <span className="absolute top-0 right-0 rounded-br-full surface-glass" style={fillet} />
      </span>
      <span data-nav-corner="bottom" className="absolute top-[calc(100%-1px)] right-0 bg-canvas" style={plate}>
        <span className="absolute right-0 bottom-0 rounded-tr-full surface-glass" style={fillet} />
      </span>
    </>
  );
}

/** Content sits in front of the rail and shares the canvas plane with the selected row. */
export const RAIL_CONTENT_CLASS = 'relative z-10 min-w-0 w-full bg-canvas px-4 py-6 md:px-8 md:py-8 xl:px-10';
