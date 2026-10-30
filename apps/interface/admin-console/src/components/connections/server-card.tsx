import { cn } from '@techma/ui';
import type { ToolServer } from '@/lib/tool-servers';

const countLabel = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

/** One MCP server (derived from its tools). Selected = ink; pressing it filters the actions table. */
export function ServerCard({
  server,
  enabledCount,
  selected,
  onSelect,
}: {
  server: ToolServer;
  enabledCount: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const chip = cn('rounded-pill px-2.5 py-1', selected ? 'bg-on-action/15' : 'bg-sunken');
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'ui-press flex min-h-11 min-w-0 flex-[1_1_320px] flex-col gap-3.5 rounded-[26px] p-6 text-left',
        selected ? 'border-2 border-action bg-action text-on-action' : 'border border-line bg-surface text-ink',
      )}
    >
      <span className="font-display text-[22px] font-extrabold tracking-[-0.03em] break-all">{server.host}</span>
      <span className="font-mono text-[13px] break-all opacity-80">{server.url}</span>
      <span className="flex flex-wrap gap-1.5 text-xs font-bold">
        <span className={chip}>auth bearer · {server.secretRefs.join(', ')}</span>
        <span className={chip}>{countLabel(server.tools.length, 'action', 'actions')}</span>
        <span className={chip}>{countLabel(enabledCount, 'activée', 'activées')}</span>
      </span>
    </button>
  );
}
