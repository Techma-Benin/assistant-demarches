import { describe, expect, it } from 'vitest';
import {
  statusGraphHeight,
  statusGraphNodeExtent,
  statusGraphTranslateExtent,
} from '@/components/operator/status/status-graph-layout';

describe('status graph layout extents', () => {
  it('keeps translate extent covering the full tall pane', () => {
    const paneWidth = 932;
    const paneHeight = 740;
    const translate = statusGraphTranslateExtent(paneWidth, paneHeight);
    expect(translate).toEqual([
      [0, 0],
      [paneWidth, paneHeight],
    ]);
  });

  it('clamps node drag inside the pane while layout stays shorter', () => {
    const paneWidth = 932;
    const paneHeight = 740;
    const contentHeight = statusGraphHeight(paneWidth, true);
    expect(contentHeight).toBeLessThan(paneHeight);

    const nodeExtent = statusGraphNodeExtent(paneWidth, paneHeight, true);
    expect(nodeExtent[0]).toEqual([8, 8]);
    expect(nodeExtent[1][0]).toBeGreaterThan(8);
    expect(nodeExtent[1][1]).toBeGreaterThan(8);
    expect(nodeExtent[1][1]).toBeLessThan(paneHeight);
  });
});
