import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { Problem, approvedMcpUrl, canonical, eventId, fingerprint, validate } from './domain.js';
import { compileMcpSchema, catalog, type McpAuth, type ToolingPort, type ToolDefinition } from './tooling.js';
import type { Principal } from './domain.js';
export type McpServer = {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    transport: 'streamable-http';
    auth: McpAuth;
    policy: 'generic' | 'techma';
};
export const modelToolName = (server: McpServer, name: string) => server.policy === 'techma' && catalog.some(t => t.name === name)
    ? name : 'mcp_' + createHash('sha256').update(server.id + '\0' + name).digest('hex').slice(0, 48);
export class McpConnections {
    constructor(private pool: Pool, private allowed: ReadonlySet<string>, private gateway?: ToolingPort) { }
    validate(value: McpServer) {
        validate("McpServer", value);
        if (!value.name.trim())
            throw new Problem(400, "INVALID_REQUEST", "Nom de connexion vide.");
        if (!approvedMcpUrl(value.url, this.allowed))
            throw new Problem(403, "FORBIDDEN", "URL MCP non autorisée au déploiement.");
        const auth = value.auth;
        if (auth.type === "headers" && Object.keys(auth.headers).some(name =>
            /^(host|cookie|content-|connection|transfer-|mcp-|x-user-|x-conversation-|x-mandate-|traceparent|idempotency-key)/i.test(name)))
            throw new Problem(400, "INVALID_REQUEST", "En-tête réservé au protocole ou à l’identité interne.");
        if (auth.type === "oauth-client-credentials" && !approvedMcpUrl(auth.tokenUrl, this.allowed))
            throw new Problem(400, "INVALID_REQUEST", "URL OAuth non autorisée au déploiement.");
    }
    async get(admin: string, id: string): Promise<McpServer> {
        const result = await this.pool.query(
            "SELECT body FROM backend_mcp_servers WHERE administration_id=$1 AND id=$2", [admin, id]);
        if (!result.rowCount) throw new Problem(404, "NOT_FOUND", "Serveur MCP introuvable.");
        return result.rows[0].body;
    }
    async list(admin: string, limit = 20, cursor?: string) {
        let after = '';
        if (cursor) {
            try {
                const v = JSON.parse(Buffer.from(cursor, 'base64url').toString());
                if (v.admin !== admin || typeof v.after !== 'string')
                    throw Error();
                after = v.after;
            }
            catch {
                throw new Problem(400, 'INVALID_REQUEST', 'Curseur invalide.');
            }
        }
        const rows = (await this.pool.query('SELECT id,body FROM backend_mcp_servers WHERE administration_id=$1 AND id>$2 ORDER BY id LIMIT $3', [admin, after, limit + 1])).rows;
        return { items: rows.slice(0, limit).map(r => r.body), nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ admin, after: rows[limit - 1].id })).toString('base64url') : null };
    }
    async mutate(principal: Principal, id: string, body: McpServer | null, method: 'POST' | 'PUT' | 'DELETE', key: string, traceparent: string) {
        if (method !== "DELETE") {
            this.validate(body!);
            if (body!.id !== id)
                throw new Problem(400, 'INVALID_REQUEST', 'Identifiant incompatible.');
        }
        const scope = canonical([principal.administrationId, principal.subject, 'mcp-servers', id, method]);
        const digest = fingerprint(body);
        const db = await this.pool.connect();
        try {
            await db.query('BEGIN');
            await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [canonical([principal.administrationId, 'mcp-server', id])]);
            const previous = (await db.query('SELECT fingerprint,response FROM backend_idempotency WHERE scope=$1 AND key=$2 AND expires_at>now()', [scope, key])).rows[0];
            if (previous) {
                if (previous.fingerprint !== digest)
                    throw new Problem(409, 'IDEMPOTENCY_CONFLICT', 'Clé déjà utilisée.');
                await db.query('COMMIT');
                return previous.response;
            }
            const current = (await db.query('SELECT body FROM backend_mcp_servers WHERE administration_id=$1 AND id=$2 FOR UPDATE', [principal.administrationId, id])).rows[0];
            if (method === 'POST' && current)
                throw new Problem(409, 'INVALID_TRANSITION', 'Serveur déjà existant.');
            if (method !== 'POST' && !current)
                throw new Problem(404, 'NOT_FOUND', 'Serveur introuvable.');
            if (method === 'POST')
                await db.query('INSERT INTO backend_mcp_servers(administration_id,id,body) VALUES($1,$2,$3)', [principal.administrationId, id, body]);
            if (method === 'PUT') {
                // Endpoint/auth changes invalidate previously discovered schemas and permissions.
                if (canonical([current.body.url, current.body.auth, current.body.policy]) !== canonical([body!.url, body!.auth, body!.policy]))
                    await db.query('DELETE FROM backend_mcp_tools WHERE administration_id=$1 AND server_id=$2', [principal.administrationId, id]);
                await db.query('UPDATE backend_mcp_servers SET body=$3,revision=revision+1 WHERE administration_id=$1 AND id=$2', [principal.administrationId, id, body]);
            }
            if (method === 'DELETE')
                await db.query('DELETE FROM backend_mcp_servers WHERE administration_id=$1 AND id=$2', [principal.administrationId, id]);
            await this.audit(db, principal, id, method, traceparent);
            await db.query("INSERT INTO backend_idempotency(scope,key,fingerprint,response) VALUES($1,$2,$3,$4) ON CONFLICT(scope,key) DO UPDATE SET fingerprint=excluded.fingerprint,response=excluded.response,expires_at=now()+interval '24 hours'", [scope, key, digest, JSON.stringify(body)]);
            await db.query('COMMIT');
            return body;
        }
        catch (e) {
            await db.query('ROLLBACK');
            throw e;
        }
        finally {
            db.release();
        }
    }
    private async audit(db: PoolClient, p: Principal, id: string, operation: string, traceparent: string) { const idEvent = eventId(); await db.query('INSERT INTO backend_outbox(id,administration_id,event) VALUES($1,$2,$3)', [idEvent, p.administrationId, { specversion: '1.0', id: idEvent, source: 'urn:techma:backend', type: 'bj.techma.configuration.changed.v1', time: new Date().toISOString(), datacontenttype: 'application/json', traceparent, data: { kind: 'configuration.changed', resource: 'tools', resourceId: 'mcp:' + id, actorRef: p.subject, operation: operation === "POST" ? "created" : operation === "DELETE" ? "deleted" : "updated" } }]); }
    async discover(p: Principal, id: string, traceparent: string) {
        const server = await this.get(p.administrationId, id);
        if (!this.gateway)
            throw new Problem(503, 'UPSTREAM_UNAVAILABLE', 'Client MCP non configuré.');
        // Discovery is deliberately possible on a disabled connection before enabling it.
        let definitions: ToolDefinition[];
        try {
            definitions = await this.gateway.discover(server.url, server.auth, { conversationId: '', userRef: '', traceparent, external: true });
        }
        catch {
            throw new Problem(503, 'MCP_DISCOVERY_FAILED', 'Découverte MCP impossible ; vérifier le serveur et son authentification.');
        }
        if (definitions.length > 1000 || new Set(definitions.map(d => d.name)).size !== definitions.length)
            throw new Problem(503, 'UPSTREAM_UNAVAILABLE', 'Catalogue MCP invalide.');
        for (const d of definitions) {
            if (typeof d.name !== 'string' || !d.name || d.name.length > 200 || !d.inputSchema || d.inputSchema.type !== 'object')
                throw new Problem(503, 'UPSTREAM_UNAVAILABLE', 'Définition MCP invalide.');
            try {
                compileMcpSchema(d.inputSchema);
                if (d.outputSchema)
                    compileMcpSchema(d.outputSchema);
            }
            catch {
                throw new Problem(503, 'UPSTREAM_UNAVAILABLE', 'Schéma MCP non pris en charge.');
            }
        }
        const db = await this.pool.connect();
        try {
            await db.query('BEGIN');
            const row = (await db.query('SELECT body FROM backend_mcp_servers WHERE administration_id=$1 AND id=$2 FOR UPDATE', [p.administrationId, id])).rows[0];
            if (!row || canonical(row.body) !== canonical(server))
                throw new Problem(409, 'INVALID_TRANSITION', 'Connexion modifiée pendant la découverte.');
            await db.query('UPDATE backend_mcp_tools SET available=false WHERE administration_id=$1 AND server_id=$2', [p.administrationId, id]);
            for (const d of definitions)
                await db.query('INSERT INTO backend_mcp_tools(administration_id,server_id,name,definition,available) VALUES($1,$2,$3,$4,true) ON CONFLICT(administration_id,server_id,name) DO UPDATE SET definition=excluded.definition,available=true,enabled=CASE WHEN backend_mcp_tools.definition IS NULL OR backend_mcp_tools.definition=excluded.definition THEN backend_mcp_tools.enabled ELSE false END', [p.administrationId, id, d.name, d]);
            await this.audit(db, p, id, 'discovered', traceparent);
            await db.query('COMMIT');
        }
        catch (e) {
            await db.query('ROLLBACK');
            throw e;
        }
        finally {
            db.release();
        }
        return this.tools(p.administrationId, id);
    }
    async tools(admin: string, id: string) { const server = await this.get(admin, id); const rows = (await this.pool.query('SELECT * FROM backend_mcp_tools WHERE administration_id=$1 AND server_id=$2 ORDER BY name', [admin, id])).rows; return { items: rows.map(r => ({ ...r.definition, name: r.name, enabled: r.enabled, requiresMandate: r.requires_mandate, available: r.available, modelName: modelToolName(server, r.name) })), nextCursor: null }; }
    async permission(p: Principal, id: string, name: string, body: {
        enabled: boolean;
        requiresMandate: boolean;
    }, traceparent: string) {
        await this.get(p.administrationId, id);
        if (!body || typeof body.enabled !== 'boolean' || typeof body.requiresMandate !== 'boolean' || Object.keys(body).some(k => !['enabled', 'requiresMandate'].includes(k)))
            throw new Problem(400, 'INVALID_REQUEST', 'Permission invalide.');
        const db = await this.pool.connect();
        try {
            await db.query('BEGIN');
            const server = (await db.query('SELECT body FROM backend_mcp_servers WHERE administration_id=$1 AND id=$2 FOR UPDATE', [p.administrationId, id])).rows[0]?.body;
            if (!server)
                throw new Problem(404, 'NOT_FOUND', 'Serveur introuvable.');
            const mandatory = server.policy === 'techma' && catalog.find(d => d.name === name)?._meta?.['bj.techma/requiresMandate'];
            if (mandatory && !body.requiresMandate)
                throw new Problem(400, 'INVALID_REQUEST', 'Le mandat est obligatoire pour cette action.');
            const r = await db.query('UPDATE backend_mcp_tools SET enabled=$4,requires_mandate=$5 WHERE administration_id=$1 AND server_id=$2 AND name=$3 AND available=true RETURNING name', [p.administrationId, id, name, body.enabled, body.requiresMandate]);
            if (!r.rowCount)
                throw new Problem(404, 'NOT_FOUND', 'Action découverte introuvable.');
            await this.audit(db, p, id + '/' + name, 'permission.updated', traceparent);
            await db.query('COMMIT');
            return (await this.tools(p.administrationId, id)).items.find(t => t.name === name)!;
        }
        catch (e) {
            await db.query('ROLLBACK');
            throw e;
        }
        finally {
            db.release();
        }
    }
}
