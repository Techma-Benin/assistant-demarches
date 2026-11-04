import { Position, type Edge, type Node } from '@xyflow/react';
import type { BranchNodeData } from './status-graph-nodes';

const HUB_WIDTH = 176;
const HUB_HEIGHT = 168;
const CARD_WIDTH = 288;
const CARD_HEIGHT = 108;
const ADMIN_CHIPS_EXTRA = 44;
const STEM = 28;
const ROW_GAP = 16;
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
    return HUB_HEIGHT + STEM + Math.max(CARD_HEIGHT, adminHeight) + 24;
  }
  const adminHeight = adminHasChips ? CARD_HEIGHT + ADMIN_CHIPS_EXTRA : CARD_HEIGHT;
  return HUB_HEIGHT + STEM + CARD_HEIGHT + ROW_GAP + CARD_HEIGHT + ROW_GAP + adminHeight + 24;
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
      draggable: false,
      selectable: false,
      focusable: false,
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
        draggable: false,
        selectable: false,
        focusable: false,
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
        draggable: false,
        selectable: false,
        focusable: false,
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

export { ADMIN_CHIPS_EXTRA, CARD_HEIGHT, CARD_WIDTH, HUB_HEIGHT, STACK_BREAK };
