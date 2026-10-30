import type { Pool, PoolClient } from 'pg';
import { Problem, validate, fingerprint, identifier } from './domain.js';
import { idempotent, transaction } from './transactions.js';
import { appendEvent, envelope } from './conversations.js';
export type WorkItem = {
    id: string;
    conversationId: string;
    userRef: string;
    procedureId: string;
    administrationId: string;
    title: string;
    status: string;
    revision: number;
    fields: Record<string, unknown>;
    fileIds: string[];
    officialLink: string | null;
    updatedAt: string;
    createdAt: string;
    simulation: boolean;
    submittedAt?: string;
    completedAt?: string;
    completedBy?: 'ai' | 'human';
    receiptRef?: string;
    assignedTo?: string | null;
    dueAt?: string;
    blocking?: {
        code: string;
        detail: string;
        at: string;
    };
    payment?: {
        status: string;
        amountFcfa: number;
        currency: 'XOF';
        reference?: string;
    };
    documents?: {
        fileId: string;
        name: string;
        mimeType: string;
        createdAt: string;
        expiresAt: string;
        simulation: boolean;
    }[];
    progress?: {
        step: number;
        total: number;
        label: string;
    };
    evidence?: {
        field: string;
        source: 'user' | 'document' | 'registry';
        reference?: string;
        confirmed: boolean;
    }[];
};
export type SnapshotEvent = {
    id: string;
    source: string;
    time: string;
    type: string;
    traceparent: string;
    data: {
        kind: 'request.snapshot';
        request: WorkItem;
        actorRef?: string;
        action?: string;
    };
};
const pending = new Set(['submitted', 'processing', 'blocked']);
const uuidCursor = (value: string | undefined, departmentId: string, filter: string) => {
    if (!value)
        return '';
    try {
        const v = JSON.parse(Buffer.from(value, 'base64url').toString());
        if (v.departmentId !== departmentId || v.filter !== filter || typeof v.after !== 'string')
            throw Error();
        return v.after;
    }
    catch {
        throw new Problem(400, 'INVALID_REQUEST', 'Curseur invalide.');
    }
};
export function pageOptions(query: Record<string, unknown>, allowed: string[] = []) {
    if (Object.keys(query).some(k => !['departmentId', 'limit', 'cursor', ...allowed].includes(k)))
        throw new Problem(400, 'INVALID_REQUEST', 'Filtre inconnu.');
    const limit = query.limit ?? '20';
    if (typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 || query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 4096))
        throw new Problem(400, 'INVALID_REQUEST', 'Pagination invalide.');
    if (query.departmentId !== undefined && (typeof query.departmentId !== 'string' || !query.departmentId))
        throw new Problem(400, 'INVALID_REQUEST', 'Département invalide.');
    return { limit: Number(limit), cursor: query.cursor as string | undefined, departmentId: query.departmentId as string | undefined };
}
export class DepartmentWork {
    constructor(readonly pool: Pool) { }
    async get(id: string, db: Pick<Pool, 'query'> | Pick<PoolClient, 'query'> = this.pool): Promise<WorkItem> {
        const row = (await db.query('SELECT body FROM backend_work_items WHERE id=$1', [id])).rows[0];
        if (!row)
            throw new Problem(404, 'NOT_FOUND', 'Dossier introuvable.');
        return row.body;
    }
    async apply(db: PoolClient, event: SnapshotEvent) {
        validate('Event', event);
        validate('DepartmentRequest', event.data.request);
        if (event.source !== 'urn:techma:tooling' || event.type !== 'bj.techma.request.snapshot.v1')
            throw new Problem(403, 'FORBIDDEN', 'Source du dossier incompatible.');
        const item = event.data.request;
        if (['submitted', 'processing', 'blocked', 'completed', 'rejected'].includes(item.status) && (!item.submittedAt || !item.receiptRef))
            throw new Problem(400, 'INVALID_REQUEST', 'Accusé de dépôt requis.');
        if (item.status === 'blocked' && !item.blocking)
            throw new Problem(400, 'INVALID_REQUEST', 'Motif de blocage requis.');
        if (item.status === 'completed' && (!item.completedAt || !item.completedBy))
            throw new Problem(400, 'INVALID_REQUEST', 'Preuve de complétion requise.');
        if (item.progress && item.progress.step > item.progress.total)
            throw new Problem(400, 'INVALID_REQUEST', 'Étape au-delà du parcours.');
        if (item.payment?.status === 'paid' && !item.payment.reference)
            throw new Problem(400, 'INVALID_REQUEST', 'Référence de paiement requise.');
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [item.conversationId]);
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['snapshot:' + item.id]);
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['department-event:' + event.id]);
        const previousEvent = (await db.query('SELECT fingerprint FROM backend_department_events WHERE id=$1', [event.id])).rows[0];
        if (previousEvent) {
            if (previousEvent.fingerprint !== fingerprint(event))
                throw new Problem(409, 'IDEMPOTENCY_CONFLICT', 'Événement réutilisé.');
            return this.get(item.id, db);
        }
        const conversation = (await db.query('SELECT user_ref FROM backend_conversations WHERE id=$1', [item.conversationId])).rows[0];
        if (!conversation || conversation.user_ref !== item.userRef)
            throw new Problem(404, 'NOT_FOUND', 'Conversation du dossier introuvable.');
        const department = (await db.query('SELECT id FROM backend_departments WHERE id=$1 AND active=true', [item.administrationId])).rows[0];
        if (!department)
            throw new Problem(404, 'NOT_FOUND', 'Département introuvable.');
        const legacy = (await db.query('SELECT conversation_id,user_ref FROM backend_requests WHERE id=$1 FOR UPDATE', [item.id])).rows[0];
        if (legacy && (legacy.conversation_id !== item.conversationId || legacy.user_ref !== item.userRef))
            throw new Problem(409, 'INVALID_TRANSITION', 'Propriétaire historique du dossier incompatible.');
        const before = (await db.query('SELECT body FROM backend_work_items WHERE id=$1 FOR UPDATE', [item.id])).rows[0]?.body as WorkItem | undefined;
        if (before && (before.administrationId !== item.administrationId || before.userRef !== item.userRef || before.conversationId !== item.conversationId))
            throw new Problem(409, 'INVALID_TRANSITION', 'Routage du dossier immuable.');
        if (before && before.revision === item.revision && fingerprint(before) !== fingerprint(item))
            throw new Problem(409, 'IDEMPOTENCY_CONFLICT', 'Révision de dossier contradictoire.');
        const newer = !before || item.revision > before.revision;
        if (newer) {
            await db.query('INSERT INTO backend_work_items(id,administration_id,conversation_id,user_ref,revision,body) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body,stored_at=now()', [item.id, item.administrationId, item.conversationId, item.userRef, item.revision, item]);
            const publicRequest = publicRequestOf(item);
            await db.query('INSERT INTO backend_requests(id,conversation_id,user_ref,body,last_event_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET body=excluded.body,last_event_at=excluded.last_event_at', [item.id, item.conversationId, item.userRef, publicRequest, event.time]);
            // Internal snapshots and dossier fields never enter the citizen's replay stream.
            if (!before)
                await appendEvent(db, item.conversationId, envelope({ kind: 'request.created', request: publicRequest as any }, event.traceparent, 'tooling'));
            else if (before.status !== item.status)
                await appendEvent(db, item.conversationId, envelope({ kind: 'request.status_changed', requestId: item.id, conversationId: item.conversationId, from: before.status as any, to: item.status as any, at: item.updatedAt }, event.traceparent, 'tooling'));
            if (before && before.status !== item.status) {
                const message = { id: identifier('msg'), conversationId: item.conversationId, createdAt: new Date().toISOString(), blocks: [{ type: 'statusCard' as const, request: publicRequest as any }] };
                await appendEvent(db, item.conversationId, envelope({ kind: 'message.sent', conversationId: item.conversationId, message }, event.traceparent));
            }
        }
        await db.query('INSERT INTO backend_department_events(id,fingerprint,administration_id,request_id,revision,actor_ref,action,outcome,trace_id,at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [event.id, fingerprint(event), item.administrationId, item.id, item.revision, event.data.actorRef ?? null, event.data.action ?? 'request.updated', newer ? 'applied' : 'ignored_stale', event.traceparent.split('-')[1], event.time]);
        return newer ? item : before!;
    }
    async ingest(event: SnapshotEvent, key: string) { return idempotent(this.pool, ['tooling-events', 'department-snapshot'], key, event, db => this.apply(db, event)); }
    async list(departmentId: string, limit: number, cursor?: string, status = 'pending') {
        if (!['pending', 'completed', 'all', 'draft'].includes(status))
            throw new Problem(400, 'INVALID_REQUEST', 'Statut de liste inconnu.');
        const after = uuidCursor(cursor, departmentId, status);
        const rows = (await this.pool.query(`SELECT id,body FROM backend_work_items WHERE administration_id=$1 AND id>$2 AND ($3='all' OR ($3='pending' AND body->>'status' IN('submitted','processing','blocked')) OR ($3='completed' AND body->>'status'='completed') OR ($3='draft' AND body->>'status' IN('draft','ready'))) ORDER BY id LIMIT $4`, [departmentId, after, status, limit + 1])).rows;
        return { items: rows.slice(0, limit).map(r => adminView(r.body)), nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ departmentId, filter: status, after: rows[limit - 1].id })).toString('base64url') : null };
    }
    async dashboard(departmentId: string, from?: string, to?: string) {
        let end = to ?? new Date().toISOString(), start = from ?? new Date(Date.now() - 30 * 86400000).toISOString();
        if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(start) >= Date.parse(end) || Date.parse(end) - Date.parse(start) > 366 * 86400000)
            throw new Problem(400, 'INVALID_REQUEST', 'Période invalide (maximum 366 jours).');
        start = new Date(start).toISOString();
        end = new Date(end).toISOString();
        const rows = (await this.pool.query("SELECT w.body,c.body->>'channel' AS channel FROM backend_work_items w JOIN backend_conversations c ON c.id=w.conversation_id WHERE w.administration_id=$1 AND (w.body->>'submittedAt')::timestamptz >= $2 AND (w.body->>'submittedAt')::timestamptz < $3", [departmentId, start, end])).rows;
        const items = rows.map(r => r.body as WorkItem), completed = items.filter(i => i.status === 'completed');
        const counts: Record<string, number> = Object.create(null), channels: Record<string, number> = Object.create(null);
        for (const r of rows) {
            counts[r.body.title] = (counts[r.body.title] ?? 0) + 1;
            channels[r.channel] = (channels[r.channel] ?? 0) + 1;
        }
        const unanswered = Number((await this.pool.query("SELECT count(*)::int AS n FROM backend_unanswered WHERE administration_id=$1 AND status='open' AND created_at >= $2 AND created_at < $3", [departmentId, start, end])).rows[0].n);
        const delays = completed.map(i => Math.max(0, Date.parse(i.completedAt!) - Date.parse(i.submittedAt!))).sort((a, b) => a - b);
        return { departmentId, period: { from: start, to: end }, received: items.length, pending: items.filter(i => pending.has(i.status)).length, blocked: items.filter(i => i.status === 'blocked').length, completed: completed.length, completedByAi: completed.filter(i => i.completedBy === 'ai').length, rejected: items.filter(i => i.status === 'rejected').length, overdue: items.filter(i => pending.has(i.status) && i.dueAt && Date.parse(i.dueAt) < Date.now()).length, medianProcessingMs: delays.length ? (delays[Math.floor((delays.length - 1) / 2)] + delays[Math.floor(delays.length / 2)]) / 2 : null, unanswered, channels: Object.entries(channels).map(([channel, count]) => ({ channel, count })), mostRequested: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([title, count]) => ({ title, count })) };
    }
    async activity(departmentId: string, limit: number, cursor?: string) {
        const after = uuidCursor(cursor, departmentId, 'activity');
        const rows = (await this.pool.query('SELECT id,request_id,revision,actor_ref,action,outcome,trace_id,at FROM backend_department_events WHERE administration_id=$1 AND id>$2 ORDER BY id LIMIT $3', [departmentId, after, limit + 1])).rows;
        return { items: rows.slice(0, limit).map(r => ({ id: r.id, requestId: r.request_id, revision: Number(r.revision), actorRef: r.actor_ref, action: r.action, outcome: r.outcome, traceId: r.trace_id, at: r.at.toISOString() })), nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ departmentId, filter: 'activity', after: rows[limit - 1].id })).toString('base64url') : null };
    }
    async unanswered(departmentId: string, limit: number, cursor?: string) {
        const after = uuidCursor(cursor, departmentId, 'unanswered');
        const rows = (await this.pool.query('SELECT * FROM backend_unanswered WHERE administration_id=$1 AND id>$2 ORDER BY id LIMIT $3', [departmentId, after, limit + 1])).rows;
        return { items: rows.slice(0, limit).map(r => ({ id: r.id, conversationId: r.conversation_id, messageId: r.message_id, reason: r.reason, status: r.status, createdAt: r.created_at.toISOString(), resolvedAt: r.resolved_at?.toISOString() ?? null })), nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ departmentId, filter: 'unanswered', after: rows[limit - 1].id })).toString('base64url') : null };
    }
}
export function publicRequestOf(item: WorkItem) { return { id: item.id, conversationId: item.conversationId, userRef: item.userRef, procedureId: item.procedureId, status: item.status, fields: {}, fileIds: item.fileIds, officialLink: item.officialLink, updatedAt: item.updatedAt }; }
export function adminView(item: WorkItem) { const { userRef, conversationId, ...view } = item; return view; }
