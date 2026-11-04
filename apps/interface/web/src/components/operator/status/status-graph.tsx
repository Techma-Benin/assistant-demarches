'use client';

import { Badge, FlagGlyph } from '@techma/ui';
import { Building2, CircleCheck, CircleX, Cpu, Plug, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { OperatorStatus } from '@/lib/operator/api';
import { formatDate } from '../ui';
import './status-graph.css';

type Administration = OperatorStatus['administrations'][number];
type McpServer = OperatorStatus['mcpServers'][number];

const Reachability = ({ ok }: { ok: boolean }) => (
  <Badge
    tone={ok ? 'trust' : 'danger'}
    icon={ok ? <CircleCheck aria-hidden="true" className="size-3.5" /> : <CircleX aria-hidden="true" className="size-3.5" />}
  >
    {ok ? 'Joignable' : 'Injoignable'}
  </Badge>
);

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
  labelledBy: string;
  children: ReactNode;
}) {
  if (href) {
    return (
      <Link href={href} className="op-status-card" aria-labelledby={labelledBy}>
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
          <BranchCard href="/operateur/modeles" labelledBy="op-status-model">
            <div className="op-status-head">
              <Tile kind="model" icon={Cpu} />
              <div className="op-status-main">
                <div className="op-status-title-row">
                  <h2 id="op-status-model">Modèle</h2>
                  {status.model ? <Reachability ok={status.model.reachable} /> : null}
                </div>
                <p className="op-status-sub">{status.model ? status.model.label : 'Aucun modèle actif.'}</p>
              </div>
            </div>
          </BranchCard>
        </li>
        <li>
          <BranchCard href="/operateur/mcp" labelledBy="op-status-mcp">
            <div className="op-status-head">
              <Tile kind="mcp" icon={Plug} />
              <div className="op-status-main">
                <div className="op-status-title-row">
                  <h2 id="op-status-mcp">Serveurs MCP</h2>
                  {status.mcpServers.length > 0 ? <Reachability ok={mcpOk} /> : null}
                </div>
                <p className="op-status-sub">{mcpCopy(status.mcpServers)}</p>
              </div>
            </div>
          </BranchCard>
        </li>
        <li>
          <BranchCard labelledBy="op-status-admins">
            <div className="op-status-head">
              <Tile kind="admin" icon={Building2} />
              <div className="op-status-main">
                <div className="op-status-title-row">
                  <h2 id="op-status-admins">Administrations</h2>
                  {connected.length > 0 ? (
                    <Badge tone="trust" icon={<CircleCheck aria-hidden="true" className="size-3.5" />}>
                      {connected.length} connectée{connected.length > 1 ? 's' : ''}
                    </Badge>
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
