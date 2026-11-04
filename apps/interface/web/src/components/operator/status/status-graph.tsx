'use client';

import { FlagGlyph } from '@techma/ui';
import { Cpu, Landmark, Plug, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { OperatorStatus } from '@/lib/operator/api';
import { formatDate } from '../ui';
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

function BranchCard({
  href,
  labelledBy,
  children,
}: {
  href?: string;
  labelledBy?: string;
  children: ReactNode;
}) {
  if (href) {
    return (
      <Link href={href} className="op-status-card">
        {children}
      </Link>
    );
  }
  return (
    <div className="op-status-card" aria-labelledby={labelledBy}>
      {children}
    </div>
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

export function StatusGraph({ status }: { status: OperatorStatus }) {
  const connected = connectedAdministrations(status.administrations);
  const mcpOk = status.mcpServers.every((server) => !server.enabled || server.reachable);

  return (
    <section aria-label="Schéma des connexions" className="op-status-chain">
      <div className="op-status-root">
        <FlagGlyph decorative width={30} height={22} />
        <span className="op-status-root-name">Assistant</span>
        <span className="op-status-root-stamp">Vérifié à l’instant</span>
      </div>
      <span className="op-status-root-wire" aria-hidden="true" />
      <ul className="op-status-branches">
        <li>
          <BranchCard href="/operateur/modeles">
            <div className="op-status-head">
              <Tile kind="model" icon={Cpu} />
              <div className="op-status-main">
                <div className="op-status-title-row">
                  <h2 id="op-status-model">Modèle</h2>
                  {status.model ? <StatusBadge ok={status.model.reachable}>{status.model.reachable ? 'Joignable' : 'Injoignable'}</StatusBadge> : null}
                </div>
                <p className="op-status-sub">{status.model ? status.model.label : 'Aucun modèle actif.'}</p>
              </div>
            </div>
          </BranchCard>
        </li>
        <li>
          <BranchCard href="/operateur/mcp">
            <div className="op-status-head">
              <Tile kind="mcp" icon={Plug} />
              <div className="op-status-main">
                <div className="op-status-title-row">
                  <h2 id="op-status-mcp">Serveurs MCP</h2>
                  {status.mcpServers.length > 0 ? <StatusBadge ok={mcpOk}>{mcpOk ? 'Joignable' : 'Injoignable'}</StatusBadge> : null}
                </div>
                <p className="op-status-sub">{mcpCopy(status.mcpServers)}</p>
              </div>
            </div>
          </BranchCard>
        </li>
        <li>
          <BranchCard labelledBy="op-status-admins">
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
          </BranchCard>
        </li>
      </ul>
    </section>
  );
}
