import type { AuditEntry } from './c3-client';

export type AuditKind = 'configuration' | 'mcp' | 'deleted';
export type AuditFilter = 'all' | AuditKind;

/** Prefix-based classification of an audit action; `.deleted` wins over the prefix. */
export function auditKind(action: string): AuditKind {
  if (action.startsWith('mcp.')) return 'mcp';
  if (action.includes('.deleted')) return 'deleted';
  return 'configuration';
}

export const matchesAuditFilter = (entry: AuditEntry, filter: AuditFilter): boolean =>
  filter === 'all' || auditKind(entry.action) === filter;

/** Filters offered for the loaded entries: « MCP » and « Suppressions » only when something matches. */
export function availableAuditFilters(entries: AuditEntry[]): AuditFilter[] {
  const kinds = new Set(entries.map((entry) => auditKind(entry.action)));
  return ['all', 'configuration', ...(['mcp', 'deleted'] as const).filter((kind) => kinds.has(kind))];
}
