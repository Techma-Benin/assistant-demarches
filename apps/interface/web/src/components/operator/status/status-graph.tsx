'use client';

import {
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn } from '@techma/ui';
import { Cpu, Landmark, Plug, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { OperatorStatus } from '@/lib/operator/api';
import { formatDate } from '../ui';
import {
  ADMIN_CHIPS_EXTRA,
  CARD_HEIGHT,
  buildStatusGraphElements,
  STATUS_GRAPH_FLOW_MIN_REM,
  statusGraphFlowMinHeight,
  statusGraphHeight,
  statusGraphLayoutWidth,
  statusGraphNodeExtent,
  statusGraphTranslateExtent,
} from './status-graph-layout';
import { statusGraphNodeTypes, type BranchNodeData } from './status-graph-nodes';
import './status-graph.css';

type Administration = OperatorStatus['administrations'][number];
type McpServer = OperatorStatus['mcpServers'][number];

function StatusBadge({ ok = true, children }: { ok?: boolean; children: ReactNode }) {
  return <span className={ok ? 'op-status-badge' : 'op-status-badge is-bad'}>{children}</span>;
}

function Tile({ kind, icon: Icon }: { kind: 'model' | 'mcp' | 'admin'; icon: LucideIcon }) {
  return (
    <span className={`op-status-tile is-${kind}`}>
      <Icon aria-hidden="true" className="size-5" />
    </span>
  );
}

function mcpCopy(servers: McpServer[]): string {
  if (servers.length === 0) return 'Aucun serveur MCP.';
  return servers
    .map((server) => {
      const tools = `${server.toolCount} outil${server.toolCount > 1 ? 's' : ''}`;
      return `${server.name} · ${tools}${server.enabled ? '' : ' (désactivé)'}`;
    })
    .join(' · ');
}

function connectedAdministrations(administrations: Administration[]): Administration[] {
  return administrations.filter((administration) => administration.connection.status === 'connected');
}

const INITIAL_VIEWPORT = { x: 0, y: 0, zoom: 1 } as const;

/** Top-align the tree after layout changes; avoid fitView centering in a tall flex pane. */
function AlignViewportTopWhenReady({ layoutKey }: { layoutKey: string }) {
  const { setViewport } = useReactFlow();
  const seenLayoutKey = useRef<string | null>(null);
  useEffect(() => {
    if (seenLayoutKey.current === layoutKey) return;
    seenLayoutKey.current = layoutKey;
    const id = requestAnimationFrame(() => {
      void setViewport(INITIAL_VIEWPORT, { duration: 0 });
    });
    return () => cancelAnimationFrame(id);
  }, [layoutKey, setViewport]);
  return null;
}

function StatusGraphFlow({
  status,
  width,
  height,
  adminHasChips,
}: {
  status: OperatorStatus;
  width: number;
  height: number;
  adminHasChips: boolean;
}) {
  const layoutWidth = statusGraphLayoutWidth(width);
  const connected = useMemo(
    () => connectedAdministrations(status.administrations),
    [status.administrations],
  );
  const mcpOk = status.mcpServers.every((server) => !server.enabled || server.reachable);
  const connectedAdminKey = useMemo(
    () => connected.map((administration) => administration.id).join(','),
    [connected],
  );
  const mcpSummaryKey = useMemo(
    () =>
      status.mcpServers
        .map((server) => `${server.id}:${server.enabled}:${server.reachable}:${server.toolCount}`)
        .join('|'),
    [status.mcpServers],
  );

  const branches = useMemo(() => {
    const modelBody = (
      <div className="op-status-head">
        <Tile kind="model" icon={Cpu} />
        <div className="op-status-main">
          <div className="op-status-title-row">
            <h2 id="op-status-model">Modèle</h2>
            {status.model ? (
              <StatusBadge ok={status.model.reachable}>
                {status.model.reachable ? 'Joignable' : 'Injoignable'}
              </StatusBadge>
            ) : null}
          </div>
          <p className="op-status-sub">{status.model ? status.model.label : 'Aucun modèle actif.'}</p>
        </div>
      </div>
    );

    const mcpBody = (
      <div className="op-status-head">
        <Tile kind="mcp" icon={Plug} />
        <div className="op-status-main">
          <div className="op-status-title-row">
            <h2 id="op-status-mcp">Serveurs MCP</h2>
            {status.mcpServers.length > 0 ? (
              <StatusBadge ok={mcpOk}>{mcpOk ? 'Joignable' : 'Injoignable'}</StatusBadge>
            ) : null}
          </div>
          <p className="op-status-sub">{mcpCopy(status.mcpServers)}</p>
        </div>
      </div>
    );

    const adminBody = (
      <>
        <div className="op-status-head">
          <Tile kind="admin" icon={Landmark} />
          <div className="op-status-main">
            <div className="op-status-title-row">
              <h2 id="op-status-admins">Administrations</h2>
              {connected.length > 0 ? (
                <StatusBadge>
                  {connected.length} connectée{connected.length > 1 ? 's' : ''}
                </StatusBadge>
              ) : null}
            </div>
            <p className="op-status-sub">
              {connected.length > 0 ? 'X-Road simulé' : 'Aucune administration connectée.'}
            </p>
          </div>
        </div>
        {connected.length > 0 ? (
          <ul className="op-status-chips" aria-label="Administrations connectées">
            {connected.map((administration) => (
              <li
                key={administration.id}
                className="op-status-chip"
                title={
                  administration.connection.since
                    ? `${administration.name} · depuis le ${formatDate(administration.connection.since)}`
                    : administration.name
                }
              >
                {administration.shortName || administration.name}
              </li>
            ))}
          </ul>
        ) : null}
      </>
    );

    const adminHeight = adminHasChips ? CARD_HEIGHT + ADMIN_CHIPS_EXTRA : CARD_HEIGHT;

    return [
      {
        id: 'model' as const,
        height: CARD_HEIGHT,
        data: { href: '/operateur/modeles', children: modelBody } satisfies BranchNodeData,
      },
      {
        id: 'mcp' as const,
        height: CARD_HEIGHT,
        data: { href: '/operateur/mcp', children: mcpBody } satisfies BranchNodeData,
      },
      {
        id: 'admin' as const,
        height: adminHeight,
        data: { labelledBy: 'op-status-admins', children: adminBody } satisfies BranchNodeData,
      },
    ];
  }, [adminHasChips, connected, mcpOk, status.model, status.mcpServers]);

  const layoutNodesEdges = useMemo(
    () => buildStatusGraphElements(layoutWidth, branches),
    [branches, layoutWidth],
  );

  const layoutKey = useMemo(
    () =>
      `${layoutWidth}-${adminHasChips}-${status.model?.id ?? 'none'}-${status.mcpServers.length}`,
    [adminHasChips, layoutWidth, status.model?.id, status.mcpServers.length],
  );

  const contentKey = useMemo(
    () =>
      [
        status.model?.id ?? 'none',
        status.model?.reachable ?? 'none',
        status.model?.label ?? 'none',
        mcpSummaryKey,
        mcpOk,
        connectedAdminKey,
        adminHasChips,
      ].join(':'),
    [
      adminHasChips,
      connectedAdminKey,
      mcpOk,
      mcpSummaryKey,
      status.model?.id,
      status.model?.label,
      status.model?.reachable,
    ],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodesEdges.nodes as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutNodesEdges.edges as Edge[]);
  const layoutKeyRef = useRef<string | null>(null);
  const contentKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const layoutNodes = layoutNodesEdges.nodes as Node[];
    const layoutEdges = layoutNodesEdges.edges as Edge[];

    if (layoutKeyRef.current !== layoutKey) {
      layoutKeyRef.current = layoutKey;
      contentKeyRef.current = contentKey;
      setNodes(layoutNodes);
      setEdges(layoutEdges);
      return;
    }

    if (contentKeyRef.current === contentKey) return;
    contentKeyRef.current = contentKey;

    setNodes((current) =>
      layoutNodes.map((layoutNode) => {
        const existing = current.find((node) => node.id === layoutNode.id);
        return existing ? { ...layoutNode, position: existing.position } : layoutNode;
      }),
    );
    setEdges(layoutEdges);
  }, [contentKey, layoutKey, layoutNodesEdges, setEdges, setNodes]);

  const nodeDragExtent = useMemo(
    () => statusGraphNodeExtent(width, height, adminHasChips),
    [adminHasChips, height, width],
  );
  const viewportExtent = useMemo(
    () => statusGraphTranslateExtent(width, height),
    [height, width],
  );

  return (
    <ReactFlow
      style={{ width: '100%', height }}
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={statusGraphNodeTypes}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
      panOnDrag={false}
      panOnScroll={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      minZoom={1}
      maxZoom={1}
      defaultViewport={INITIAL_VIEWPORT}
      autoPanOnNodeDrag={false}
      preventScrolling
      nodeExtent={nodeDragExtent}
      translateExtent={viewportExtent}
      nodeDragThreshold={3}
      proOptions={{ hideAttribution: true }}
    >
      <AlignViewportTopWhenReady layoutKey={layoutKey} />
    </ReactFlow>
  );
}

export function StatusGraph({
  status,
  className,
}: {
  status: OperatorStatus;
  className?: string;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  const connected = useMemo(
    () => connectedAdministrations(status.administrations),
    [status.administrations],
  );
  const adminHasChips = connected.length > 0;
  const layoutWidth = statusGraphLayoutWidth(width);
  const layoutHeight = statusGraphHeight(layoutWidth, adminHasChips);
  const flowMinHeight = statusGraphFlowMinHeight(layoutHeight);
  const [paneHeight, setPaneHeight] = useState(flowMinHeight);

  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const applySize = (rawWidth: number, rawHeight: number) => {
      const nextWidth = statusGraphLayoutWidth(rawWidth);
      setWidth((current) => (current === nextWidth ? current : nextWidth));
      const nextHeight = Math.max(flowMinHeight, Math.round(rawHeight));
      setPaneHeight((current) => (current === nextHeight ? current : nextHeight));
    };
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width <= 0) return;
      applySize(rect.width, rect.height);
    });
    observer.observe(el);
    const rect = el.getBoundingClientRect();
    applySize(rect.width || 960, rect.height);
    return () => observer.disconnect();
  }, [flowMinHeight]);

  const flowHeight = Math.max(flowMinHeight, paneHeight);
  const flowMinCss = `max(${layoutHeight}px, ${STATUS_GRAPH_FLOW_MIN_REM}rem)`;

  return (
    <section
      aria-label="Schéma des connexions"
      className={cn('op-status-chain', className)}
      style={{ ['--op-status-flow-min' as string]: `${layoutHeight}px` }}
    >
      <div
        ref={shellRef}
        className="op-status-flow"
        style={{ minHeight: flowMinCss, height: flowHeight }}
      >
        <ReactFlowProvider>
          <StatusGraphFlow
            status={status}
            width={layoutWidth}
            height={flowHeight}
            adminHasChips={adminHasChips}
          />
        </ReactFlowProvider>
      </div>
    </section>
  );
}
