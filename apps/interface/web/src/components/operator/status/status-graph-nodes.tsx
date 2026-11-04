'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { AssistantMark } from './assistant-mark';

export type HubNodeData = Record<string, never>;

export type BranchNodeData = {
  href?: string;
  labelledBy?: string;
  children: ReactNode;
};

export function HubNode(_props: NodeProps) {
  return (
    <div className="op-status-hub-node">
      <div className="op-status-hub">
        <span className="op-status-hub-mark" role="img" aria-label="Assistant">
          <AssistantMark />
        </span>
        <span className="op-status-hub-name">Assistant</span>
        <span className="op-status-hub-stamp">Vérifié à l’instant</span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="hub-out"
        className="op-status-handle op-status-handle--source"
        isConnectable={false}
      />
    </div>
  );
}

export function BranchNode({ data }: NodeProps) {
  const { href, labelledBy, children } = data as BranchNodeData;
  const body = href ? (
    <Link href={href} className="op-status-card">
      {children}
    </Link>
  ) : (
    <div className="op-status-card" aria-labelledby={labelledBy}>
      {children}
    </div>
  );

  return (
    <div className="op-status-branch-node">
      <Handle
        type="target"
        position={Position.Top}
        id="branch-in"
        className="op-status-handle op-status-handle--target"
        isConnectable={false}
      />
      {body}
    </div>
  );
}

export const statusGraphNodeTypes = {
  hub: HubNode,
  branch: BranchNode,
};
