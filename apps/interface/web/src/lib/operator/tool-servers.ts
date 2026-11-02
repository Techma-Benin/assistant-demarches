import type { ToolConfig } from './c3-client';

export interface ToolServer {
  /** `serverUrl`, used as the identifier of the group. */
  url: string;
  host: string;
  /** Distinct `secretRef`s of its tools (references only, never secret values). */
  secretRefs: string[];
  tools: ToolConfig[];
}

/** Host of a server URL (the raw value when it is not a valid URL). */
export function serverHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** The API has no MCP-servers resource: servers are derived by grouping tools by `serverUrl`. */
export function groupToolsByServer(tools: ToolConfig[]): ToolServer[] {
  const servers = new Map<string, ToolServer>();
  for (const tool of tools) {
    let server = servers.get(tool.serverUrl);
    if (!server) {
      server = { url: tool.serverUrl, host: serverHost(tool.serverUrl), secretRefs: [], tools: [] };
      servers.set(tool.serverUrl, server);
    }
    server.tools.push(tool);
    if (!server.secretRefs.includes(tool.secretRef)) server.secretRefs.push(tool.secretRef);
  }
  return [...servers.values()];
}
