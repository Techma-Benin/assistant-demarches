'use client';

import { InlineAlert, Switch } from '@techma/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { c3, type ToolConfig } from '@/lib/c3-client';
import { toSaveFailure } from '@/lib/error-messages';
import { PaginatedTable, type Column } from './paginated-table';

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

export function ToolsTable() {
  // Values confirmed (or optimistically set) by a toggle, over the loaded rows.
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Number of failed toggles per tool: each increase replays the shake.
  const [shakes, setShakes] = useState<Record<string, number>>({});

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
      { header: 'Nom', cell: (t) => <span className={mono}>{t.name}</span> },
      {
        header: 'Activé',
        cell: (t) => (
          <ShakeOnFailure count={shakes[t.name] ?? 0}>
            <Switch
              aria-label={`Activer ${t.name}`}
              checked={enabled[t.name] ?? t.enabled}
              disabled={pending.has(t.name)}
              onCheckedChange={(next) => void toggle(t, next, enabled[t.name] ?? t.enabled)}
            />
          </ShakeOnFailure>
        ),
      },
      { header: 'Serveur', cell: (t) => <span className={mono}>{t.serverUrl}</span> },
      { header: 'Référence du secret', cell: (t) => <span className={mono}>{t.secretRef}</span> },
    ],
    // toggle only uses state setters and c3: it never goes stale
    [enabled, pending, shakes],
  );

  return (
    <div className="flex flex-col gap-3">
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      <PaginatedTable label="Outils" noun="les outils" columns={columns} rowKey={(t) => t.name} load={loadTools} />
    </div>
  );
}
