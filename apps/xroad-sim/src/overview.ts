import type { XroadStore } from './store.js';

export interface Exchange {
  at: string;
  client: string;
  operation: string;
  status: number;
  traceId: string;
}

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * The "simple view of the connections" asked for on the 29 October call: administrations,
 * their connection state and the last exchanges. No personal data: counts and operations only.
 */
export function overviewPage(store: XroadStore, exchanges: readonly Exchange[]): string {
  const superAdmin = store.listOfficials(undefined, undefined).find((official) => official.role === 'super_admin');
  const rows = store
    .listAdministrations()
    .map((administration) => {
      const metrics = superAdmin ? store.metrics(superAdmin, administration.id) : undefined;
      const connected = administration.connection.status === 'connected';
      return `<tr><td>${escape(administration.name)}</td><td class="${connected ? 'ok' : 'off'}">${connected ? 'Connectée' : 'Non connectée : connexion recommandée'}</td>
        <td>${store.searchProcedures(undefined, administration.id).length}</td><td>${metrics?.received ?? 0}</td><td>${metrics?.pending ?? 0}</td><td>${metrics?.completedByAssistant ?? 0}</td></tr>`;
    })
    .join('');
  const log = exchanges.length
    ? exchanges
        .map(
          (exchange) =>
            `<tr><td>${escape(exchange.at.slice(11, 19))}</td><td>${escape(exchange.client)}</td><td><code>${escape(exchange.operation)}</code></td><td class="${exchange.status < 400 ? 'ok' : 'off'}">${exchange.status}</td><td><code>${escape(exchange.traceId.slice(0, 8))}</code></td></tr>`,
        )
        .join('')
    : '<tr><td colspan="5">Aucun échange pour le moment.</td></tr>';

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5"><title>X-Road simulé</title>
<style>
:root{--ink:#14201a;--muted:#5b6b62;--line:#dfe6e2;--bg:#ffffff;--green:#008751;--red:#e8112d}
@media (prefers-color-scheme:dark){:root{--ink:#e8efeb;--muted:#9fb0a7;--line:#2a3a32;--bg:#0f1713}}
body{margin:0;padding:24px 16px;font:15px/1.5 system-ui,sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:980px;margin:auto}h1{margin:0 0 4px}p{color:var(--muted);margin:0 0 24px}
table{width:100%;border-collapse:collapse;margin-bottom:32px}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line)}
th{font-size:13px;color:var(--muted)}.ok{color:var(--green)}.off{color:var(--red)}.wrap{overflow-x:auto}
</style></head><body><main>
<h1>X-Road simulé</h1>
<p>Simulation déclarée : aucune donnée ne provient d'une vraie administration. Rafraîchi toutes les 5 secondes.</p>
<div class="wrap"><table><thead><tr><th>Administration</th><th>Connexion</th><th>Démarches</th><th>Dossiers</th><th>En attente</th><th>Complétés par l'assistant</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>Derniers échanges</h2>
<div class="wrap"><table><thead><tr><th>Heure (UTC)</th><th>Client</th><th>Opération</th><th>Statut</th><th>Trace</th></tr></thead><tbody>${log}</tbody></table></div>
</main></body></html>`;
}
