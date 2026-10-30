import { Problem, approvedMcpUrl, validate } from './domain.js';
import type { WorkItem } from './department-work.js';
export type AdminCommand = {
    action: 'claim' | 'request_information' | 'approve' | 'reject' | 'resume';
    revision: number;
    reason?: string;
};
export interface DepartmentCommands {
    execute(requestId: string, departmentId: string, actorRef: string, command: AdminCommand, key: string, traceparent: string): Promise<WorkItem>;
}
export class HttpDepartmentCommands implements DepartmentCommands {
    constructor(private baseUrl: string, private token: () => Promise<string>) { if (!approvedMcpUrl(baseUrl, new Set([new URL(baseUrl).href])))
        throw Error('Tooling admin endpoint requires HTTPS outside localhost.'); }
    async execute(requestId: string, departmentId: string, actorRef: string, command: AdminCommand, key: string, traceparent: string) {
        let response: Response;
        try {
            response = await fetch(new URL('/internal/v1/admin/requests/' + encodeURIComponent(requestId) + '/actions', this.baseUrl), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'application/json', 'Idempotency-Key': key, traceparent }, body: JSON.stringify({ ...command, departmentId, actorRef }) });
        }
        catch {
            throw new Problem(503, 'UPSTREAM_UNAVAILABLE', 'Service de traitement administratif indisponible.');
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw new Problem([400, 403, 404, 409].includes(response.status) ? response.status : 503, response.status === 409 ? 'INVALID_TRANSITION' : response.status === 403 ? 'FORBIDDEN' : 'UPSTREAM_UNAVAILABLE', 'Le service administratif a refusé ou interrompu la demande.');
        }
        const raw = await response.text();
        if (Buffer.byteLength(raw) > 1048576)
            throw new Problem(503, 'UPSTREAM_UNAVAILABLE', 'Réponse administrative trop volumineuse.');
        let item: WorkItem;
        try {
            item = JSON.parse(raw);
            validate('DepartmentRequest', item);
        }
        catch {
            throw new Problem(503, 'UPSTREAM_UNAVAILABLE', 'Réponse administrative non conforme.');
        }
        if (item.id !== requestId || item.administrationId !== departmentId || item.revision <= command.revision)
            throw new Problem(503, 'UPSTREAM_UNAVAILABLE', 'Réponse administrative incompatible.');
        return item;
    }
}
export function departmentCommandsFromEnvironment(): DepartmentCommands | undefined {
    const url = process.env.TOOLING_ADMIN_URL;
    if (!url)
        return undefined;
    return new HttpDepartmentCommands(url, async () => {
        if (process.env.TOOLING_ADMIN_TOKEN)
            return process.env.TOOLING_ADMIN_TOKEN;
        const tokenUrl = process.env.SERVICE_TOKEN_URL, secret = process.env.TOOLING_ADMIN_CLIENT_SECRET;
        if (!tokenUrl || !secret || !approvedMcpUrl(tokenUrl, new Set([new URL(tokenUrl).href])))
            throw new Problem(503, 'UPSTREAM_UNAVAILABLE', 'Identité administrative de service non configurée.');
        const res = await fetch(tokenUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'backend-admin', client_secret: secret, scope: 'requests:admin', audience: 'techma-tooling' }) });
        if (!res.ok)
            throw new Problem(503, 'UPSTREAM_UNAVAILABLE', 'Identité administrative indisponible.');
        const data = await res.json() as any;
        if (typeof data.access_token !== 'string')
            throw new Problem(503, 'UPSTREAM_UNAVAILABLE', 'Jeton administratif absent.');
        return data.access_token;
    });
}
