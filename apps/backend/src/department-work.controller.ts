import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import type { AuthOptions } from './auth.js';
import { requireDepartmentPrincipal, assertDepartmentPermission, refreshDepartmentPrincipal, type DepartmentPrincipal } from './department-auth.js';
import { DepartmentWork, adminView, pageOptions, type SnapshotEvent } from './department-work.js';
import type { DepartmentCommands, AdminCommand } from './department-commands.js';
import { Problem, fingerprint, identifier, validate, canonical } from './domain.js';
import { idempotent, idempotencyKey } from './transactions.js';
import type { Files } from './files.js';
export const DEPARTMENT_WORK_RUNTIME = Symbol('DEPARTMENT_WORK_RUNTIME');
export type DepartmentWorkRuntime = {
    pool: Pool;
    auth: AuthOptions;
    work: DepartmentWork;
    commands?: DepartmentCommands;
    files?: Files;
};
@Controller('v1/admin')
export class DepartmentWorkController {
    constructor(
    @Inject(DEPARTMENT_WORK_RUNTIME)
    private runtime: DepartmentWorkRuntime) { }
    private async principal(req: Request, permission: 'dept:read' | 'dept:write' = 'dept:read', departmentId?: string) { return requireDepartmentPrincipal(req, this.runtime.auth, this.runtime.pool, permission, departmentId); }
    private department(principal: DepartmentPrincipal, selected?: string) { const id = selected ?? (principal.departmentIds.length === 1 ? principal.departmentIds[0] : undefined); if (!id)
        throw new Problem(400, 'INVALID_REQUEST', 'Sélectionnez un département.'); assertDepartmentPermission(principal, 'dept:read', id); return id; }
    @Get('work-items')
    async list(
    @Req()
    req: Request) { const q = pageOptions(req.query, ['status']), p = await this.principal(req); if (req.query.status !== undefined && typeof req.query.status !== 'string')
        throw new Problem(400, 'INVALID_REQUEST', 'Statut invalide.'); return this.runtime.work.list(this.department(p, q.departmentId), q.limit, q.cursor, req.query.status as string | undefined); }
    @Get('work-items/:id')
    async detail(
    @Req()
    req: Request,
    @Param('id')
    id: string) { const p = await this.principal(req); const item = await this.runtime.work.get(id); if (!p.superAdmin && !p.departmentIds.includes(item.administrationId))
        throw new Problem(404, 'NOT_FOUND', 'Dossier introuvable.'); return adminView(item); }
    @Get('dashboard')
    async dashboard(
    @Req()
    req: Request) { const q = pageOptions(req.query, ['from', 'to']); if (['from', 'to'].some(k => req.query[k] !== undefined && typeof req.query[k] !== 'string'))
        throw new Problem(400, 'INVALID_REQUEST', 'Période invalide.'); const p = await this.principal(req); return this.runtime.work.dashboard(this.department(p, q.departmentId), req.query.from as string | undefined, req.query.to as string | undefined); }
    @Get('activity')
    async activity(
    @Req()
    req: Request) { const q = pageOptions(req.query), p = await this.principal(req); return this.runtime.work.activity(this.department(p, q.departmentId), q.limit, q.cursor); }
    @Get('unanswered')
    async unanswered(
    @Req()
    req: Request) { const q = pageOptions(req.query), p = await this.principal(req); return this.runtime.work.unanswered(this.department(p, q.departmentId), q.limit, q.cursor); }
    @Post('unanswered/:id/resolve')
    @HttpCode(200)
    async resolve(
    @Req()
    req: Request,
    @Param('id')
    id: string) {
        if (req.body !== undefined && Object.keys(req.body).length)
            throw new Problem(400, 'INVALID_REQUEST', 'Aucun corps attendu.');
        const row = (await this.runtime.pool.query('SELECT administration_id FROM backend_unanswered WHERE id=$1', [id])).rows[0];
        if (!row)
            throw new Problem(404, 'NOT_FOUND', 'Question introuvable.');
        const principal = await this.principal(req, 'dept:write', row.administration_id);
        if (!row.administration_id && !principal.superAdmin)
            throw new Problem(403, 'FORBIDDEN', 'Question sans département réservée au super administrateur.');
        return idempotent(this.runtime.pool, ['unanswered', principal.subject, row.administration_id, id], idempotencyKey(req.get('Idempotency-Key')), {}, async (db) => { await db.query("UPDATE backend_unanswered SET status='resolved',resolved_at=coalesce(resolved_at,now()) WHERE id=$1", [id]); return { id, status: 'resolved' }; });
    }
    @Post('work-items/:id/actions')
    @HttpCode(200)
    async action(
    @Req()
    req: Request,
    @Param('id')
    id: string,
    @Body()
    body: AdminCommand) {
        validate('AdminCommand', body);
        const item = await this.runtime.work.get(id), p = await this.principal(req, 'dept:write', item.administrationId);
        const key = idempotencyKey(req.get('Idempotency-Key'));
        const remoteKey = fingerprint([p.subject, item.administrationId, id, key]);
        const scope = canonical(['admin-command', p.subject, item.administrationId, id]);
        const digest = fingerprint(body);
        const db = await this.runtime.pool.connect();
        let locked = false, inTransaction = false;
        try {
            // Session lock spans the durable RPC marker and the projection transaction.
            // It uses the same conversation lock as event ingestion, and a crash releases it.
            await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [item.conversationId]);
            locked = true;
            const actor = await refreshDepartmentPrincipal(db, p);
            assertDepartmentPermission(actor, 'dept:write', item.administrationId);
            const previous = (await db.query('SELECT fingerprint,response FROM backend_idempotency WHERE scope=$1 AND key=$2 AND expires_at>now()', [scope,key])).rows[0];
            if (previous) {
                if (previous.fingerprint !== digest) throw new Problem(409,'IDEMPOTENCY_CONFLICT','Clé réutilisée pour une autre commande.');
                return previous.response;
            }
            await db.query('INSERT INTO backend_admin_command_attempts(command_key,fingerprint) VALUES($1,$2) ON CONFLICT DO NOTHING', [remoteKey,digest]);
            const attempt = (await db.query('SELECT fingerprint,sent_at FROM backend_admin_command_attempts WHERE command_key=$1', [remoteKey])).rows[0];
            if (attempt.fingerprint !== digest) throw new Problem(409,'IDEMPOTENCY_CONFLICT','Clé réutilisée pour une autre commande.');
            const current = await this.runtime.work.get(id,db);
            if (current.revision !== body.revision && !attempt.sent_at) throw new Problem(409,'INVALID_TRANSITION','Le dossier a changé ; rechargez-le.');
            if (!this.runtime.commands) throw new Problem(503,'UPSTREAM_UNAVAILABLE','Connecteur de traitement administratif non configuré.');
            // Autocommit before the RPC, without borrowing another pool connection.
            await db.query('UPDATE backend_admin_command_attempts SET sent_at=coalesce(sent_at,now()) WHERE command_key=$1', [remoteKey]);
            const next = await this.runtime.commands.execute(id,item.administrationId,p.subject,body,remoteKey,req.get('traceparent')!);
            const event = {specversion:'1.0',id:identifier('evt'),source:'urn:techma:tooling',type:'bj.techma.request.snapshot.v1',time:new Date().toISOString(),datacontenttype:'application/json',traceparent:req.get('traceparent')!,data:{kind:'request.snapshot',request:next,actorRef:p.subject,action:'admin.'+body.action}} as SnapshotEvent;
            await db.query('BEGIN');
            inTransaction = true;
            await this.runtime.work.apply(db,event);
            const result = adminView(next);
            await db.query("INSERT INTO backend_idempotency(scope,key,fingerprint,response) VALUES($1,$2,$3,$4) ON CONFLICT(scope,key) DO UPDATE SET fingerprint=excluded.fingerprint,response=excluded.response,expires_at=now()+interval '24 hours'", [scope,key,digest,JSON.stringify(result)]);
            await db.query('COMMIT');
            inTransaction = false;
            return result;
        } catch(error) {
            if(inTransaction) await db.query('ROLLBACK');
            throw error;
        } finally {
            try {
                if(locked) await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[item.conversationId]);
            } finally { db.release(); }
        }
    }

    @Get('work-items/:id/documents/:fileId')
    async document(
    @Req()
    req: Request,
    @Res()
    res: Response,
    @Param('id')
    id: string,
    @Param('fileId')
    fileId: string) {
        const item = await this.runtime.work.get(id), p = await this.principal(req);
        if (!p.superAdmin && !p.departmentIds.includes(item.administrationId))
            throw new Problem(404, 'NOT_FOUND', 'Document introuvable.');
        const metadata = item.documents?.find(d => d.fileId === fileId);
        if (!metadata || Date.parse(metadata.expiresAt) <= Date.now() || !this.runtime.files)
            throw new Problem(404, 'NOT_FOUND', 'Document introuvable ou expiré.');
        const file = await this.runtime.files.readOwned(fileId, item.userRef);
        res.setHeader('Content-Type', file.file.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(metadata.name)}`);
        res.setHeader('Cache-Control', 'no-store');
        res.send(file.bytes);
    }
}
