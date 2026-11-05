import { describe, expect, it } from 'vitest';
import {
  CARD_WIDTH,
  STATUS_GRAPH_FLOW_MIN_REM,
  buildStatusGraphElements,
  statusGraphFlowMinHeight,
  statusGraphHeight,
  statusGraphLayoutWidth,
  statusGraphNodeExtent,
} from '@/components/operator/status/status-graph-layout';
import type { BranchNodeData } from '@/components/operator/status/status-graph-nodes';

const dummy: BranchNodeData = { children: null };

describe('status graph layout extents', () => {
  it('never shrinks the flow pane below layout height or 28rem', () => {
    const layoutHeight = statusGraphHeight(960, false);
    expect(statusGraphFlowMinHeight(layoutHeight)).toBe(
      Math.max(layoutHeight, STATUS_GRAPH_FLOW_MIN_REM * 16),
    );
  });

  it('never buckets layout width past the pane', () => {
    expect(statusGraphLayoutWidth(980)).toBeLessThanOrEqual(980);
    expect(statusGraphLayoutWidth(980)).toBe(960);
  });

  it('uses the full pane as nodeExtent; xyflow subtracts each node size', () => {
    const paneWidth = 1200;
    const paneHeight = 852;
    expect(statusGraphNodeExtent(paneWidth, paneHeight)).toEqual([
      [0, 0],
      [paneWidth, paneHeight],
    ]);
  });

  it('places the admin card with room to drag left and right', () => {
    const paneWidth = 1200;
    const paneHeight = 852;
    const { nodes } = buildStatusGraphElements(paneWidth, [
      { id: 'model', height: 108, data: dummy },
      { id: 'mcp', height: 108, data: dummy },
      { id: 'admin', height: 152, data: dummy },
    ]);
    const admin = nodes.find((node) => node.id === 'admin');
    expect(admin).toBeTruthy();
    const [min, max] = statusGraphNodeExtent(paneWidth, paneHeight);
    const maxOriginX = max[0] - CARD_WIDTH;
    expect(admin!.position.x).toBeGreaterThan(min[0]);
    expect(admin!.position.x).toBeLessThan(maxOriginX);
    expect(maxOriginX - admin!.position.x).toBeGreaterThan(100);
    expect(admin!.position.x - min[0]).toBeGreaterThan(100);
  });
});
