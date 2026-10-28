import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { generateKeyPair, createLocalJWKSet, exportJWK, SignJWT } from 'jose';
import { isolatedDatabase } from './helpers.mjs';
import { database, migrate, provision } from '../dist/apps/backend/src/database.js';
import { catalog, McpGateway } from '../dist/apps/backend/src/tooling.js';
import { McpConnections } from '../dist/apps/backend/src/mcp-connections.js';
import { createBackend } from '../dist/apps/backend/src/app.js';
import { Conversations } from '../dist/apps/backend/src/conversations.js';
import { Agent } from '../dist/apps/backend/src/agent.js';
import { identifier, validate } from '../dist/apps/backend/src/domain.js';
const tp = '00-' + '1'.repeat(32) + '-' + '2'.repeat(16) + '-01';
const definition = { name: 'echo.same', description: 'Return service-specific information', inputSchema: { $id:'https://schemas.example/echo', type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } };
test('Server-centric MCP: real discovery, auth, tenant isolation, dynamic routing and revocation', async (t) => {
    const pg = await isolatedDatabase(), pool = database(pg.connection);
    await migrate(pool);
    const calls = [], lists = [];
    let changed = false;
    let removed = false;
    const upstream = http.createServer(async (req, res) => {
        if (req.url === '/token') {
            let body = '';
            for await (const c of req)
                body += c;
            const form = new URLSearchParams(body);
            assert.equal(form.get('grant_type'), 'client_credentials');
            assert.equal(form.get('client_secret'), 'client-secret');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ access_token: 'private-token', token_type: 'Bearer', expires_in: 120 }));
            return;
        }
        const path = req.url;
        if (path === '/b' && req.headers.authorization !== 'Bearer private-token') {
            res.writeHead(401);
            res.end();
            return;
        }
        if (path === '/header' && req.headers['x-api-key'] !== 'private-token') {
            res.writeHead(401);
            res.end();
            return;
        }
        assert.equal(req.headers['x-user-ref'], undefined, 'Generic services do not receive internal user identity');
        const server = new Server({ name: path, version: '1' }, { capabilities: { tools: {} } });
        server.setRequestHandler(ListToolsRequestSchema, async (request) => {
            lists.push({ path, cursor: request.params?.cursor });
            return request.params?.cursor ? { tools: removed && path === "/a" ? [] : [{ name: 'second', inputSchema: { type: 'object' } }] } : { tools: [{ ...definition, inputSchema:{...definition.inputSchema,description:path}, ...(changed && path === '/a' ? { description: 'Changed schema contract' } : {}) }], nextCursor: 'page2' };
        });
        server.setRequestHandler(CallToolRequestSchema, async (request) => { calls.push({ path, name: request.params.name, args: request.params.arguments }); return { content: [{ type: 'text', text: path + ':' + request.params.arguments.text }] }; });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => { transport.close(); server.close(); });
        await server.connect(transport);
        const chunks = [];
        for await (const c of req)
            chunks.push(c);
        await transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined);
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const origin = 'http://127.0.0.1:' + upstream.address().port;
    const allowed = new Set(['/a', '/b', '/header', '/token'].map(p => origin + p));
    const gateway = new McpGateway(allowed, async (ref) => ({ token: 'private-token', client: 'client-secret' })[ref] ?? Promise.reject(Error('missing secret')));
    const keys = await generateKeyPair('RS256');
    const auth = { issuer: 'https://identity.example', audience: 'techma-backend', key: createLocalJWKSet({ keys: [{ ...await exportJWK(keys.publicKey), kid: 'test', alg: 'RS256' }] }) };
    const jwt = async (admin = 'alpha', scope = 'admin:read admin:write') => new SignJWT({ administrationId: admin, scope }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject('admin').setIssuer(auth.issuer).setAudience(auth.audience).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    const app = await createBackend({ pool, auth, allowedMcpUrls: allowed, mcpGateway: gateway });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const token = await jwt();
    let n = 0;
    t.after(async () => { await app.close(); upstream.closeAllConnections(); await new Promise(r => upstream.close(r)); await pool.end(); await pg.close(); });
    async function request(path, method = 'GET', body, credential = token, key = 'mcp-key-' + (++n)) {
        const r = await fetch(base + '/v1/admin' + path, { method, headers: { Authorization: 'Bearer ' + credential, traceparent: tp, 'Idempotency-Key': key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return { status: r.status, body: r.status === 204 ? null : await r.json() };
    }
    const a = { id: 'a', name: 'First MCP', url: origin + '/a', enabled: true, transport: 'streamable-http', auth: { type: 'none' }, policy: 'generic' };
    const b = { ...a, id: 'b', name: 'Second MCP', url: origin + '/b', auth: { type: 'bearer', secretRef: 'token' } };
    const principal = { subject: 'admin', administrationId: 'alpha', scopes: new Set(['admin:read', 'admin:write']) };
    const settings = new McpConnections(pool, allowed, gateway);
    await t.test('CRUD, references only, scope and administration boundaries', async () => {
        assert.equal((await request('/mcp-servers', 'POST', null)).status, 400);
        assert.equal((await request('/mcp-servers', 'POST', a)).status, 201);
        assert.equal((await request('/mcp-servers', 'POST', b)).status, 201);
        assert.equal((await request('/mcp-servers', 'POST', a)).status, 409);
        const listed = await request('/mcp-servers?limit=1');
        validate('McpServerPage', listed.body);
        assert.equal(listed.body.items.length, 1);
        assert.ok(listed.body.nextCursor);
        assert.equal((await request('/mcp-servers?limit=1&cursor=' + encodeURIComponent(listed.body.nextCursor))).body.items[0].id, 'b');
        assert.equal((await request('/mcp-servers/a', 'GET', undefined, await jwt('beta'))).status, 404);
        assert.equal((await request('/mcp-servers?cursor=' + encodeURIComponent(listed.body.nextCursor), 'GET', undefined, await jwt('beta'))).status, 400);
        assert.equal((await request('/mcp-servers', 'POST', { ...a, id: 'bad' }, await jwt('alpha', 'admin:read'))).status, 403);
        assert.equal((await request('/mcp-servers', 'POST', { ...a, id: 'bad', url: 'http://169.254.169.254/' })).status, 403);
        assert.equal((await request('/mcp-servers', 'POST', { ...a, id: 'bad', auth: { type: 'oauth-authorization-code' } })).status, 400);
        assert.equal((await request('/mcp-servers', 'POST', { ...a, id: 'bad', auth: { type: 'headers', headers: { 'X-User-Ref': 'token' } } })).status, 400);
        const detail = (await request('/mcp-servers/b')).body;
        assert.equal(JSON.stringify(detail).includes('private-token'), false);
        assert.equal(detail.auth.secretRef, 'token');
    });
    await t.test('Real tools/list pagination and opt-in permissions, immutable remote names', async () => {
        for (const id of ['a', 'b']) {
            const r = await request('/mcp-servers/' + id + '/discover', 'POST');
            assert.equal(r.status, 200);
            validate('McpToolPage', r.body);
            assert.equal(r.body.items.length, 2);
            assert.ok(r.body.items.every(t => !t.enabled && t.requiresMandate));
            assert.equal((await request('/mcp-servers/' + id + '/tools/echo.same', 'PUT', { enabled: true, requiresMandate: false })).status, 200);
        }
        assert.ok(lists.some(l => l.cursor === 'page2'));
        assert.equal((await request('/mcp-servers/a/tools/echo.same', 'PUT', { enabled: true, requiresMandate: false, name: 'renamed' })).status, 400);
        assert.equal((await request('/mcp-servers/a/tools/invented', 'PUT', { enabled: true, requiresMandate: false })).status, 404);
    });
    const conversations = new Conversations(pool);
    const user = { userRef: identifier('usr'), administrationId: 'alpha', channel: 'portal', expiresAt: Date.now() + 60000 };
    await provision(pool, 'alpha', 'models', { id: 'model', provider: 'fixture', model: 'fixture', promptVersion: 'agent-v1', temperature: 0, active: true });
    async function run(models) { const c = await conversations.create(user, { channel: 'web', locale: 'fr' }, 'create-' + (++n)); const msg = { id: identifier('msg'), content: { type: 'text', text: 'Use both services' }, sentAt: new Date().toISOString() }; await conversations.accept(user, c.id, msg, 'accept-' + (++n), tp); await new Agent(pool, conversations, models, gateway).process(c.id); return c; }
    await t.test('Unknown catalogue action on two MCPs, colliding remote names, text results reach model', async () => {
        let turn = 0;
        await run({ async generate(config, history, tools) {
                if (!turn++) {
                    assert.equal(tools.length, 2);
                    assert.notEqual(tools[0].name, tools[1].name);
                    assert.ok(tools.every(t => t.name.startsWith('mcp_') && t.description === definition.description));
                    return { text: '', calls: tools.map((tool, i) => ({ id: 'call' + i, name: tool.name, arguments: JSON.stringify({ text: 'hello' }) })) };
                }
                const outputs = history.filter(t => t.role === 'tool');
                assert.ok(outputs.some(t => t.content.includes('/a:hello')));
                assert.ok(outputs.some(t => t.content.includes('/b:hello')));
                return { text: JSON.stringify({ blocks: [{ type: 'text', text: 'Résultats des deux services.', sources: [] }] }), calls: [] };
            } });
        assert.deepEqual(calls.map(c => [c.path, c.name]), [['/a', 'echo.same'], ['/b', 'echo.same']]);
    });
    await t.test('Permission change takes effect immediately before execution', async () => {
        let turn = 0;
        const before = calls.length;
        await run({ async generate(config, history, tools) { if (!turn++) {
                await settings.permission(principal, 'a', 'echo.same', { enabled: false, requiresMandate: false }, tp);
                return { text: '', calls: [{ id: 'revoked', name: tools.find(t => t.name === (tools[0].name)).name, arguments: '{"text":"blocked"}' }] };
            } assert.ok(history.find(t => t.role === 'tool').content.includes('FORBIDDEN')); return { text: JSON.stringify({ blocks: [{ type: 'text', text: 'Action refusée.', sources: [] }] }), calls: [] }; } });
        assert.equal(calls.length, before);
    });
    await t.test('Rediscovery disables changed contracts and marks removed tools unavailable', async () => {
        await settings.permission(principal, 'a', 'echo.same', { enabled: true, requiresMandate: false }, tp);
        changed = true;
        removed = true;
        const found = await settings.discover(principal, 'a', tp);
        assert.equal(found.items.find(t => t.name === 'echo.same').enabled, false);
        assert.equal(found.items.find(t => t.name === 'second').available, false);
    });
    await t.test('Header and OAuth client credentials authentication are real, errors sanitized', async () => {
        const context = { conversationId: '', userRef: '', traceparent: tp, external: true };
        assert.equal((await gateway.discover(origin + '/header', { type: 'headers', headers: { 'X-Api-Key': 'token' } }, context)).length, 2);
        assert.equal((await gateway.discover(origin + '/b', { type: 'oauth-client-credentials', tokenUrl: origin + '/token', clientId: 'client-id', clientSecretRef: 'client' }, context)).length, 2);
        await assert.rejects(gateway.discover(origin + '/b', { type: 'none' }, context), e => e.code === 'MCP_CONNECTION_FAILED' && !e.message.includes('private-token'));
        assert.equal((await request('/mcp-servers', 'POST', { ...a, id: 'oauth', auth: { type: 'oauth-client-credentials', tokenUrl: 'https://not-allowed.example/token', clientId: 'id', clientSecretRef: 'client' } })).status, 400);
    });
    await t.test('Server disable, endpoint edit invalidation, cascading deletion and idempotent replay', async () => {
        assert.equal((await request('/mcp-servers/b', 'PUT', { ...b, enabled: false })).status, 200);
        await run({ async generate(config,history,tools) {assert.equal(tools.length,0);return {text:JSON.stringify({blocks:[{type:'text',text:'Aucune action disponible.',sources:[]}]}),calls:[]};}});
        const tools = (await request('/mcp-servers/b/tools')).body;
        assert.equal(tools.items.length, 2);
        assert.equal((await request('/mcp-servers/b', 'PUT', { ...b, url: origin + '/header', auth: { type: 'headers', headers: { 'X-Api-Key': 'token' } } })).status, 200);
        assert.equal((await request('/mcp-servers/b/tools')).body.items.length, 0);
        assert.equal((await request('/mcp-servers/b', 'DELETE', undefined, token, 'same-delete-key')).status, 204);
        assert.equal((await request('/mcp-servers/b', 'DELETE', undefined, token, 'same-delete-key')).status, 204);
        assert.equal((await request('/mcp-servers/b')).status, 404);
        assert.equal((await pool.query("SELECT count(*)::int n FROM backend_mcp_tools WHERE administration_id='alpha' AND server_id='b'")).rows[0].n, 0);
    });
});


test('Migration des actions historiques : groupes par administration et identifiants conservés',async t=>{
 const pg=await isolatedDatabase(),pool=database(pg.connection);
 t.after(async()=>{await pool.end();await pg.close();});
 await migrate(pool);
 for(const admin of ['alpha','beta'])for(const tool of catalog)await provision(pool,admin,'tools',{name:tool.name,enabled:tool.name!=='request.update',serverUrl:'http://127.0.0.1:4030/mcp',secretRef:'backend-agent'});
 // Reconstruct a database from before migration 006, retaining the historical rows.
 await pool.query('DROP TABLE backend_mcp_tools');await pool.query('DROP TABLE backend_mcp_servers');
 await pool.query("DELETE FROM backend_migrations WHERE name='006_mcp_servers.sql'");
 await migrate(pool);
 const servers=(await pool.query('SELECT administration_id,body FROM backend_mcp_servers ORDER BY administration_id')).rows;
 assert.equal(servers.length,2);assert.equal(servers[0].body.policy,'techma');assert.equal(servers[0].body.auth.secretRef,'backend-agent');
 for(const admin of ['alpha','beta']){
  const tools=(await pool.query('SELECT name,enabled,requires_mandate FROM backend_mcp_tools WHERE administration_id=$1',[admin])).rows;
  assert.equal(tools.length,8);
  for(const tool of tools){assert.equal(tool.enabled,tool.name!=='request.update');assert.equal(tool.requires_mandate,Boolean(catalog.find(t=>t.name===tool.name)._meta['bj.techma/requiresMandate']));}
 }
});
