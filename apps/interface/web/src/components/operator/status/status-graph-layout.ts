import { Position, type Edge, type Node } from '@xyflow/react';
import type { BranchNodeData } from './status-graph-nodes';

const HUB_WIDTH = 176;
const HUB_HEIGHT = 168;
const CARD_WIDTH = 288;
const CARD_HEIGHT = 108;
const ADMIN_CHIPS_EXTRA = 44;
/** Vertical hub→branch gap so smoothstep stems stay visible in the flow pane. */
const STEM = 96;
const ROW_GAP = 24;
const FLOW_BOTTOM_PAD = 40;
const STACK_BREAK = 920;
const HANDLE_SIZE = 6;

const CHILD_IDS = ['model', 'mcp', 'admin'] as const;

const hubHandles = [
  {
    id: 'hub-out',
    type: 'source' as const,
    position: Position.Bottom,
    x: HUB_WIDTH / 2 - HANDLE_SIZE / 2,
    y: HUB_HEIGHT - HANDLE_SIZE / 2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
  },
];

function branchHandles() {
  return [
    {
      id: 'branch-in',
      type: 'target' as const,
      position: Position.Top,
      x: CARD_WIDTH / 2 - HANDLE_SIZE / 2,
      y: -HANDLE_SIZE / 2,
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
    },
  ];
}

export function statusGraphHeight(containerWidth: number, adminHasChips: boolean): number {
  if (containerWidth >= STACK_BREAK) {
    const adminHeight = adminHasChips ? CARD_HEIGHT + ADMIN_CHIPS_EXTRA : CARD_HEIGHT;
    return HUB_HEIGHT + STEM + Math.max(CARD_HEIGHT, adminHeight) + FLOW_BOTTOM_PAD;
  }
  const adminHeight = adminHasChips ? CARD_HEIGHT + ADMIN_CHIPS_EXTRA : CARD_HEIGHT;
  return HUB_HEIGHT + STEM + CARD_HEIGHT + ROW_GAP + CARD_HEIGHT + ROW_GAP + adminHeight + FLOW_BOTTOM_PAD;
}

const NODE_EXTENT_PAD = 8;

/** Clamp draggable nodes inside the visible flow pane (top-left origin). */
export function statusGraphNodeExtent(
  paneWidth: number,
  paneHeight: number,
  adminHasChips: boolean,
): [[number, number], [number, number]] {
  const maxNodeHeight = adminHasChips ? CARD_HEIGHT + ADMIN_CHIPS_EXTRA : CARD_HEIGHT;
  const maxNodeWidth = CARD_WIDTH;
  const pad = NODE_EXTENT_PAD;
  const innerW = Math.max(0, paneWidth - pad * 2);
  const innerH = Math.max(0, paneHeight - pad * 2);
  const maxX = Math.max(pad, pad + innerW - maxNodeWidth);
  const maxY = Math.max(pad, pad + innerH - maxNodeHeight);
  return [
    [pad, pad],
    [maxX, maxY],
  ];
}

/** Viewport pan bounds: full pane so the tree stays visible with empty drag space below. */
export function statusGraphTranslateExtent(
  paneWidth: number,
  paneHeight: number,
): [[number, number], [number, number]] {
  return [
    [0, 0],
    [Math.max(1, paneWidth), Math.max(1, paneHeight)],
  ];
}

type BranchPayload = {
  id: (typeof CHILD_IDS)[number];
  data: BranchNodeData;
  height: number;
};

export function buildStatusGraphElements(
  containerWidth: number,
  branches: BranchPayload[],
): { nodes: Node[]; edges: Edge[] } {
  const stacked = containerWidth < STACK_BREAK;
  const width = Math.max(containerWidth, CARD_WIDTH);

  const hubX = (width - HUB_WIDTH) / 2;
  const nodes: Node[] = [
    {
      id: 'hub',
      type: 'hub',
      position: { x: hubX, y: 0 },
      data: {},
      width: HUB_WIDTH,
      height: HUB_HEIGHT,
      measured: { width: HUB_WIDTH, height: HUB_HEIGHT },
      handles: hubHandles,
      draggable: true,
    },
  ];

  if (stacked) {
    let y = HUB_HEIGHT + STEM;
    for (const branch of branches) {
      const x = (width - CARD_WIDTH) / 2;
      nodes.push({
        id: branch.id,
        type: 'branch',
        position: { x, y },
        data: branch.data,
        width: CARD_WIDTH,
        height: branch.height,
        measured: { width: CARD_WIDTH, height: branch.height },
        handles: branchHandles(),
        draggable: true,
      });
      y += branch.height + ROW_GAP;
    }
  } else {
    const gap = ROW_GAP;
    const totalRow = branches.length * CARD_WIDTH + (branches.length - 1) * gap;
    let x = (width - totalRow) / 2;
    const rowY = HUB_HEIGHT + STEM;
    for (const branch of branches) {
      nodes.push({
        id: branch.id,
        type: 'branch',
        position: { x, y: rowY },
        data: branch.data,
        width: CARD_WIDTH,
        height: branch.height,
        measured: { width: CARD_WIDTH, height: branch.height },
        handles: branchHandles(),
        draggable: true,
      });
      x += CARD_WIDTH + gap;
    }
  }

  const edges: Edge[] = CHILD_IDS.map((id) => ({
    id: `hub-${id}`,
    source: 'hub',
    target: id,
    sourceHandle: 'hub-out',
    targetHandle: 'branch-in',
    type: 'smoothstep',
    selectable: false,
    focusable: false,
    animated: false,
    style: { stroke: 'var(--ui-trust-line)', strokeWidth: 2 },
    pathOptions: { borderRadius: 12, offset: 4 },
  }));

  return { nodes, edges };
}

/** Buckets container width so ResizeObserver sub-pixel jitter does not relayout. */
export function statusGraphLayoutWidth(containerWidth: number): number {
  if (containerWidth <= 0) return STACK_BREAK;
  return Math.max(CARD_WIDTH, Math.round(containerWidth / 32) * 32);
}

export { ADMIN_CHIPS_EXTRA, CARD_HEIGHT, CARD_WIDTH, HUB_HEIGHT, STACK_BREAK };
