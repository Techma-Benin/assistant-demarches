'use client';

import { useEffect, useState } from 'react';
import { c3 } from './c3-client';
import { collectAll, CAPS } from './dashboard-data';
import { can, type Identity } from './permissions';
import { visibleProcedures } from './visible-procedures';

/** What the shell can tell from the admin APIs alone. `null` = could not be determined. */
export interface ServiceStatus {
  backendReachable: boolean;
  /** Distinct `serverUrl` among enabled tools. */
  mcpConnections: number | null;
  /** `provider · model` of the active ModelConfig, `''` when none is active. */
  activeModel: string | null;
  draftProcedures: number | null;
  disabledTools: number | null;
}

export async function loadServiceStatus(identity: Identity | null): Promise<ServiceStatus> {
  // Only what the active identity may view is requested (the rest would answer 403).
  const [metrics, tools, models, procedures] = await Promise.allSettled([
    c3.getMetrics(),
    can(identity, 'tools.view') ? collectAll((params) => c3.listTools(params), CAPS.tools) : Promise.reject(new Error('not allowed')),
    can(identity, 'models.view') ? collectAll((params) => c3.listModels(params), CAPS.models) : Promise.reject(new Error('not allowed')),
    collectAll((params) => c3.listProcedures(params), CAPS.procedures),
  ]);
  const toolItems = tools.status === 'fulfilled' ? tools.value.items : null;
  const active = models.status === 'fulfilled' ? models.value.items.find((model) => model.active) : undefined;
  return {
    backendReachable: metrics.status === 'fulfilled',
    mcpConnections: toolItems
      ? new Set(toolItems.filter((tool) => tool.enabled && tool.serverUrl).map((tool) => tool.serverUrl)).size
      : null,
    activeModel: models.status === 'fulfilled' ? (active ? `${active.provider} · ${active.model}` : '') : null,
    draftProcedures:
      procedures.status === 'fulfilled'
        ? visibleProcedures(identity, procedures.value.items).filter((procedure) => procedure.validationStatus === 'draft').length
        : null,
    disabledTools: toolItems ? toolItems.filter((tool) => !tool.enabled).length : null,
  };
}

/** Loads once; `null` while loading. Never throws (failures show as unknown values). */
export function useServiceStatus(identity: Identity | null): ServiceStatus | null {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    loadServiceStatus(identity).then(
      (value) => !cancelled && setStatus(value),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
    // Reload when the active identity changes.
  }, [identity]);
  return status;
}
