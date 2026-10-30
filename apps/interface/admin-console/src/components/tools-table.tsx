'use client';

import { InlineAlert, Switch, Toast } from '@techma/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { c3, type ToolConfig } from '@/lib/c3-client';
import { toSaveFailure } from '@/lib/error-messages';
import { groupToolsByServer } from '@/lib/tool-servers';
import { ServerCard } from './connections/server-card';
import { PageHeader } from './page-header';
import { PaginatedTable, type Column } from './paginated-table';
import { useToast } from './use-toast';

const LIMIT = 20;
const mono = 'font-mono text-[13px]';

const loadTools = (cursor: string | null) => c3.listTools({ cursor, limit: LIMIT });

/** Shakes its content each time `count` grows, without re-mounting it (keyboard focus stays on the switch). */
function ShakeOnFailure({ count, children }: { count: number; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (count === 0 || !el || typeof el.animate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    el.animate(
      [0, -3, 3, -3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 220, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' },
    );
  }, [count]);
  return (
    <span ref={ref} className="inline-block">
      {children}
    </span>
  );
}

/** « Connexions MCP »: servers derived from the tools' `serverUrl`, and the actions of the selected one. */
export function ToolsTable() {
  const [loaded, setLoaded] = useState<ToolConfig[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  // Values confirmed (or optimistically set) by a toggle, over the loaded rows.
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Number of failed toggles per tool: each increase replays the shake.
  const [shakes, setShakes] = useState<Record<string, number>>({});
  const toast = useToast();

  const servers = useMemo(() => groupToolsByServer(loaded), [loaded]);
  const selected = servers.find((server) => server.url === selectedUrl) ?? servers[0] ?? null;
  const isEnabled = (tool: ToolConfig) => enabled[tool.name] ?? tool.enabled;

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
      toast.show(`${saved.enabled ? 'Action activée' : 'Action désactivée'} : ${tool.name}`);
    } catch (caught) {
      setEnabled((values) => ({ ...values, [tool.name]: previous }));
      setShakes((counts) => ({ ...counts, [tool.name]: (counts[tool.name] ?? 0) + 1 }));
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
      { header: 'Action', cell: (t) => <span className={`${mono} font-semibold`}>{t.name}</span> },
      {
        header: 'Activée',
        cell: (t) => (
          <ShakeOnFailure count={shakes[t.name] ?? 0}>
            <Switch
              tone="trust"
              aria-label={`Activer ${t.name}`}
              checked={enabled[t.name] ?? t.enabled}
              disabled={pending.has(t.name)}
              onCheckedChange={(next) => void toggle(t, next, enabled[t.name] ?? t.enabled)}
            />
          </ShakeOnFailure>
        ),
      },
    ],
    // toggle only uses state setters and c3: it never goes stale
    [enabled, pending, shakes],
  );

  return (
    <>
      <PageHeader
        title="Connexions MCP"
        description="Les serveurs et actions que le modèle peut utiliser, et sous quelles conditions."
        actions={<Toast message={toast.message} onDismiss={toast.dismiss} />}
      />
      <div className="flex flex-col gap-5">
        {servers.length > 0 ? (
          <ul aria-label="Serveurs MCP" className="flex flex-wrap gap-4">
            {servers.map((server) => (
              <li key={server.url} className="flex min-w-0 flex-[1_1_320px]">
                <ServerCard
                  server={server}
                  enabledCount={server.tools.filter(isEnabled).length}
                  selected={server.url === selected?.url}
                  onSelect={() => setSelectedUrl(server.url)}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {error ? <InlineAlert>{error}</InlineAlert> : null}

        <section aria-labelledby="actions-title" className="flex flex-col gap-3">
          {selected ? (
            <h2 id="actions-title" className="font-display text-[22px] font-extrabold tracking-[-0.03em] break-words">
              Actions de « {selected.host} »
            </h2>
          ) : (
            <h2 id="actions-title" className="font-display text-[22px] font-extrabold tracking-[-0.03em]">
              Actions
            </h2>
          )}
          <PaginatedTable
            label="Actions"
            noun="les actions"
            columns={columns}
            rowKey={(t) => t.name}
            load={loadTools}
            filter={(t) => selected !== null && t.serverUrl === selected.url}
            onItemsChange={setLoaded}
            className="min-w-[360px]"
          />
        </section>

        <p className="text-[13px] text-ink-subtle">
          Les secrets ne sont jamais saisis ici : seule une référence (<span className="font-mono">secretRef</span>) est
          enregistrée.
        </p>
      </div>
    </>
  );
}
