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
import { Cpu, Landmark, Plug, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { OperatorStatus } from '@/lib/operator/api';
import { formatDate } from '../ui';
import {
  ADMIN_CHIPS_EXTRA,
  CARD_HEIGHT,
  buildStatusGraphElements,
  statusGraphHeight,
  statusGraphLayoutWidth,
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

const FIT_VIEW_OPTIONS = {
  padding: { top: 0.02, right: 0.06, bottom: 0.12, left: 0.06 },
  minZoom: 1,
  maxZoom: 1,
} as const;

function FitViewWhenReady({ layoutKey }: { layoutKey: string }) {
  const { fitView } = useReactFlow();
  const seenLayoutKey = useRef<string | null>(null);
  useEffect(() => {
    if (seenLayoutKey.current === layoutKey) return;
    seenLayoutKey.current = layoutKey;
    const id = requestAnimationFrame(() => {
      void fitView({ ...FIT_VIEW_OPTIONS, duration: 0 });
    });
    return () => cancelAnimationFrame(id);
  }, [fitView, layoutKey]);
  return null;
}

function StatusGraphFlow({ status, width }: { status: OperatorStatus; width: number }) {
  const layoutWidth = statusGraphLayoutWidth(width);
  const connected = useMemo(
    () => connectedAdministrations(status.administrations),
    [status.administrations],
  );
  const mcpOk = status.mcpServers.every((server) => !server.enabled || server.reachable);
  const adminHasChips = connected.length > 0;
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

  return (
    <ReactFlow
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
      preventScrolling={false}
      nodeDragThreshold={3}
      proOptions={{ hideAttribution: true }}
    >
      <FitViewWhenReady layoutKey={layoutKey} />
    </ReactFlow>
  );
}

export function StatusGraph({ status }: { status: OperatorStatus }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);

  const connected = useMemo(
    () => connectedAdministrations(status.administrations),
    [status.administrations],
  );
  const layoutWidth = statusGraphLayoutWidth(width);
  const height = statusGraphHeight(layoutWidth, connected.length > 0);

  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const applyWidth = (raw: number) => {
      const next = statusGraphLayoutWidth(raw);
      setWidth((current) => (current === next ? current : next));
    };
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) applyWidth(next);
    });
    observer.observe(el);
    applyWidth(el.getBoundingClientRect().width || 960);
    return () => observer.disconnect();
  }, []);

  return (
    <section aria-label="Schéma des connexions" className="op-status-chain">
      <div ref={shellRef} className="op-status-flow" style={{ height }}>
        <ReactFlowProvider>
          <StatusGraphFlow status={status} width={width} />
        </ReactFlowProvider>
      </div>
    </section>
  );
}
