'use client';

import { InlineAlert, Switch } from '@techma/ui';
import { useMemo, useState } from 'react';
import { c3, type ToolConfig } from '@/lib/c3-client';
import { toSaveFailure } from '@/lib/error-messages';
import { PaginatedTable, type Column } from './paginated-table';

const LIMIT = 20;
const mono = 'font-mono text-[13px]';

const loadTools = (cursor: string | null) => c3.listTools({ cursor, limit: LIMIT });

export function ToolsTable() {
  // Values confirmed (or optimistically set) by a toggle, over the loaded rows.
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // `previous` is the last confirmed value, restored if the update fails.
  const toggle = async (tool: ToolConfig, next: boolean, previous: boolean) => {
    setError(null);
    setPending((names) => new Set(names).add(tool.name));
    setEnabled((values) => ({ ...values, [tool.name]: next }));
    // Full replacement: only `enabled` differs from the loaded tool.
    const key = `tool-${tool.name}-${crypto.randomUUID()}`;
    try {
      const saved = await c3.updateTool({ ...tool, enabled: next }, key);
      setEnabled((values) => ({ ...values, [tool.name]: saved.enabled }));
    } catch (caught) {
      setEnabled((values) => ({ ...values, [tool.name]: previous }));
      setError(`${toSaveFailure(caught).message} (${tool.name})`);
    } finally {
      setPending((names) => {
        const rest = new Set(names);
        rest.delete(tool.name);
        return rest;
      });
    }
  };

  const columns = useMemo<Column<ToolConfig>[]>(
    () => [
      { header: 'Nom', cell: (t) => <span className={mono}>{t.name}</span> },
      {
        header: 'Activé',
        cell: (t) => (
          <Switch
            aria-label={`Activer ${t.name}`}
            checked={enabled[t.name] ?? t.enabled}
            disabled={pending.has(t.name)}
            onCheckedChange={(next) => void toggle(t, next, enabled[t.name] ?? t.enabled)}
          />
        ),
      },
      { header: 'Serveur', cell: (t) => <span className={mono}>{t.serverUrl}</span> },
      { header: 'Référence du secret', cell: (t) => <span className={mono}>{t.secretRef}</span> },
    ],
    // toggle only uses state setters and c3: it never goes stale
    [enabled, pending],
  );

  return (
    <div className="flex flex-col gap-3">
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      <PaginatedTable label="Outils" noun="les outils" columns={columns} rowKey={(t) => t.name} load={loadTools} />
    </div>
  );
}
