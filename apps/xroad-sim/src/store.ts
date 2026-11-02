import type { ValidateFunction } from 'ajv/dist/2020.js';
import type { Schemas } from '@techma/contracts-ts';
import { ajv } from './contracts.js';
import {
  DEMO_OFFICIALS,
  type ActivityEntry,
  type Administration,
  type Case,
  type CaseDocument,
  type CaseStep,
  type Catalogue,
  type CatalogueEntry,
  type FieldValue,
  type InstructionRule,
  type Official,
  type Procedure,
} from './data.js';
import type { Tx } from './database.js';
import { newId } from './ids.js';
import { simulatedPdf } from './pdf.js';
import { ProblemError, forbidden, invalid, invalidTransition, notFound } from './problem.js';

export type Caller = { kind: 'applicant'; applicantRef: string } | { kind: 'official'; official: Official };
export type CaseView = Schemas['CaseView'];
export type CaseInput = Schemas['CaseInput'];
export type CaseResponseInput = Schemas['CaseResponseInput'];
export type CaseAction = Schemas['CaseActionInput']['action'];
type DocumentRef = Schemas['DocumentRef'];
type UploadMime = CaseDocument['mimeType'];

export interface StoredReply {
  fingerprint: string;
  reply: { status: number; body: unknown };
}

export interface Page {
  limit: number;
  offset: number;
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const UPLOAD_TTL = HOUR;
const REPLY_TTL = DAY;
const DEFAULT_PERIOD = 30 * DAY;
const PENDING_STATUSES = ['received', 'in_review', 'information_requested'];
const CHANNELS: Case['channel'][] = ['web', 'whatsapp'];
const ISSUED_DOCUMENT_TYPE = 'document-delivre';

const VIEW_STATUSES: Record<CaseView, string[] | null> = {
  pending: PENDING_STATUSES,
  completed: ['completed'],
  rejected: ['rejected'],
  all: null,
};

const PERMISSIONS: Record<Official['role'], Schemas['Permission'][]> = {
  agent: ['cases:read', 'cases:act'],
  admin: ['cases:read', 'cases:act', 'officials:read', 'officials:manage'],
  super_admin: ['cases:read', 'cases:act', 'officials:read', 'officials:manage', 'administrations:all'],
};

export class XroadStore {
  private readonly administrations: Map<string, Administration>;
  private readonly catalogue: Map<string, CatalogueEntry>;
  private readonly forms = new Map<string, ValidateFunction>();
  private readonly now: () => number;

  constructor(catalogue: Catalogue, now: () => number = Date.now) {
    this.administrations = new Map(catalogue.administrations.map((administration) => [administration.id, administration]));
    this.catalogue = new Map(catalogue.entries.map((entry) => [entry.procedure.id, entry]));
    this.now = now;
  }

  /** Registers the demo officials once: a change made later in the console survives a restart. */
  async seedDirectory(tx: Tx): Promise<void> {
    for (const official of DEMO_OFFICIALS) {
      await tx.query(
        `insert into xroad_officials (id, subject, email, administration_id, role, body) values ($1, $2, $3, $4, $5, $6::jsonb)
         on conflict (subject) do nothing`,
        [official.id, official.subject, official.email, official.administrationId, official.role, JSON.stringify(official)],
      );
    }
  }

  async recall(tx: Tx, scope: string): Promise<StoredReply | undefined> {
    const [row] = await tx.query<{ fingerprint: string; status: number; body: unknown }>(
      'select fingerprint, status, body from xroad_replies where scope = $1 and created_at > $2',
      [scope, new Date(this.now() - REPLY_TTL)],
    );
    return row ? { fingerprint: row.fingerprint, reply: { status: row.status, body: row.body } } : undefined;
  }

  async remember(tx: Tx, scope: string, stored: StoredReply): Promise<void> {
    await tx.query('delete from xroad_replies where created_at <= $1', [new Date(this.now() - REPLY_TTL)]);
    await tx.query('insert into xroad_replies (scope, fingerprint, status, body, created_at) values ($1, $2, $3, $4::jsonb, $5)', [
      scope,
      stored.fingerprint,
      stored.reply.status,
      JSON.stringify(stored.reply.body),
      new Date(this.now()),
    ]);
  }

  listAdministrations(): Administration[] {
    return [...this.administrations.values()];
  }

  /**
   * Ranked search over the official sheets: a citizen's question ("comment renouveler mon passeport") must find the sheet
   * even when its words differ ("renouvellement"). Title matches weigh more; sheets covering fewer than half of the best
   * sheet's terms are dropped. No query: the whole catalogue in its order.
   */
  searchProcedures(query: string | undefined, administrationId?: string, assisted?: boolean): Procedure[] {
    const procedures = [...this.catalogue.values()]
      .map((entry) => entry.procedure)
      .filter((procedure) => !administrationId || procedure.administrationId === administrationId)
      .filter((procedure) => assisted === undefined || (procedure.filing !== null) === assisted);
    const terms = [...new Set(searchTerms(query ?? ''))];
    if (terms.length === 0) return query?.trim() ? [] : procedures;
    const scored = procedures
      .map((procedure) => {
        const title = new Set(searchTerms(procedure.title));
        const body = new Set(searchTerms(`${procedure.summary} ${procedure.authority ?? ''}`));
        const matched = terms.filter((term) => title.has(term) || body.has(term));
        const score = matched.reduce((sum, term) => sum + (title.has(term) ? 3 : 1), 0);
        return { procedure, matched: matched.length, score };
      })
      .filter((entry) => entry.matched > 0);
    const best = Math.max(0, ...scored.map((entry) => entry.matched));
    return scored
      .filter((entry) => entry.matched * 2 >= best)
      .sort((a, b) => b.matched - a.matched || b.score - a.score || a.procedure.id.localeCompare(b.procedure.id))
      .map((entry) => entry.procedure);
  }

  getProcedure(procedureId: string): Procedure {
    const entry = this.catalogue.get(procedureId);
    if (!entry) throw notFound('Démarche inconnue');
    return entry.procedure;
  }

  async upload(tx: Tx, applicantRef: string, mimeType: UploadMime, content: Buffer): Promise<Schemas['Upload']> {
    await tx.query('delete from xroad_uploads where expires_at <= $1', [new Date(this.now())]);
    const upload: Schemas['Upload'] = {
      id: newId('upl', this.now()),
      mimeType,
      sizeBytes: content.length,
      expiresAt: new Date(this.now() + UPLOAD_TTL).toISOString(),
    };
    await tx.query('insert into xroad_uploads (id, applicant_ref, mime_type, size_bytes, content, expires_at) values ($1, $2, $3, $4, $5, $6)', [
      upload.id,
      applicantRef,
      mimeType,
      content.length,
      content,
      new Date(upload.expiresAt),
    ]);
    return upload;
  }

  async createCase(tx: Tx, applicantRef: string, input: CaseInput): Promise<Case> {
    const entry = this.catalogue.get(input.procedureId);
    if (!entry) throw notFound('Démarche inconnue');
    const { procedure, rule } = entry;
    if (!procedure.filing || !rule) {
      throw new ProblemError(409, 'NOT_ASSISTED', `Dépôt par l'assistant non disponible pour cette démarche : voir la fiche officielle ${procedure.source.url}`);
    }
    if (this.administrations.get(procedure.administrationId)?.connection.status !== 'connected') {
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Administration non connectée à X-Road : dépôt impossible, connexion recommandée');
    }
    const [existing] = await tx.query('select id from xroad_cases where request_id = $1', [input.requestId]);
    if (existing) throw new ProblemError(409, 'CONFLICT', 'Demande déjà déposée');

    const form = this.formValidator(procedure);
    if (!form(input.fields)) throw new ProblemError(409, 'REQUEST_INCOMPLETE', `Formulaire incomplet : ${ajv.errorsText(form.errors, { dataVar: 'champs' })}`);
    const provided = new Set(input.documents.map((document) => document.documentType));
    const missing = procedure.filing.requiredDocuments.filter((required) => !provided.has(required.documentType));
    if (missing.length) throw new ProblemError(409, 'REQUEST_INCOMPLETE', `Pièces manquantes : ${missing.map((required) => required.label).join(', ')}`);

    const at = this.iso();
    const fee = procedure.filing.feeFcfa;
    const record: Case = {
      id: newId('cas', this.now()),
      reference: await this.nextReference(tx, rule.code),
      simulated: true,
      procedureId: procedure.id,
      title: procedure.title,
      administrationId: procedure.administrationId,
      applicantRef,
      requestId: input.requestId,
      channel: input.channel,
      status: fee > 0 ? 'awaiting_payment' : 'received',
      fields: { ...input.fields },
      documents: [],
      payment: { amountFcfa: fee, status: fee > 0 ? 'pending' : 'not_required', reference: null, paidAt: null, simulated: true },
      steps: [
        step('form', "Demande préparée avec l'assistant", 'done', 'assistant', at),
        step('documents', 'Pièces transmises', 'done', 'assistant', at),
        ...(fee > 0 ? [step('payment', `Frais de ${fee} FCFA à régler`, 'pending', 'applicant', null)] : []),
      ],
      informationRequest: null,
      claimedBy: null,
      completedBy: null,
      decisionNote: null,
      createdAt: at,
      updatedAt: at,
    };
    await tx.query(
      `insert into xroad_cases (id, request_id, administration_id, applicant_ref, status, created_at, updated_at, body)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [record.id, record.requestId, record.administrationId, record.applicantRef, record.status, new Date(at), new Date(at), JSON.stringify(record)],
    );
    record.documents = await this.takeUploads(tx, record.id, applicantRef, input.documents, procedure, at);
    await this.log(tx, record, 'assistant', null, 'case.created', null, at);
    if (record.status === 'received') await this.instruct(tx, record, rule);
    await this.saveCase(tx, record);
    return record;
  }

  async getCase(tx: Tx, caller: Caller, caseId: string): Promise<Case> {
    const [row] = await tx.query<{ body: Case }>('select body from xroad_cases where id = $1', [caseId]);
    if (!row || !this.canSee(caller, row.body)) throw notFound('Dossier inconnu');
    return row.body;
  }

  async listCases(tx: Tx, caller: Caller, administrationId: string | undefined, view: CaseView, page: Page): Promise<{ items: Case[]; hasMore: boolean }> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const where = (clause: string, value: unknown) => {
      params.push(value);
      clauses.push(clause.replace('?', `$${params.length}`));
    };
    if (caller.kind === 'applicant') {
      where('applicant_ref = ?', caller.applicantRef);
      if (administrationId) where('administration_id = ?', administrationId);
    } else {
      const scope = this.scopeOf(caller.official, administrationId);
      if (scope !== null) where('administration_id = ?', scope);
    }
    const statuses = VIEW_STATUSES[view];
    if (statuses) where('status = any(?)', statuses);
    // Pending work: oldest first, so nothing waits for weeks at the bottom of the list.
    const order = view === 'pending' ? 'created_at asc, id asc' : 'updated_at desc, id desc';
    const rows = await tx.query<{ body: Case }>(
      `select body from xroad_cases ${clauses.length ? `where ${clauses.join(' and ')}` : ''} order by ${order} limit ${page.limit + 1} offset ${page.offset}`,
      params,
    );
    return { items: rows.slice(0, page.limit).map((row) => row.body), hasMore: rows.length > page.limit };
  }

  async pay(tx: Tx, applicantRef: string, caseId: string): Promise<Case> {
    const record = await this.lockCase(tx, { kind: 'applicant', applicantRef }, caseId);
    if (record.status !== 'awaiting_payment') throw invalidTransition('Aucun paiement attendu pour ce dossier');
    const at = this.iso();
    const reference = `SIM-PAY-${record.reference.slice(-6)}`;
    record.payment = { ...record.payment, status: 'paid', reference, paidAt: at };
    this.updateStep(record, 'payment', { label: `Frais de ${record.payment.amountFcfa} FCFA réglés par Mobile Money (simulation)`, state: 'done', at });
    record.status = 'received';
    record.updatedAt = at;
    await this.log(tx, record, 'applicant', null, 'case.paid', reference, at);
    await this.instruct(tx, record, this.ruleOf(record));
    await this.saveCase(tx, record);
    return record;
  }

  async respond(tx: Tx, applicantRef: string, caseId: string, input: CaseResponseInput): Promise<Case> {
    const record = await this.lockCase(tx, { kind: 'applicant', applicantRef }, caseId);
    if (record.status !== 'information_requested') throw invalidTransition("Aucun complément n'est attendu pour ce dossier");
    const fields = { ...record.fields, ...input.fields };
    const procedure = this.getProcedure(record.procedureId);
    const form = this.formValidator(procedure);
    if (!form(fields)) throw invalid(`Champs invalides : ${ajv.errorsText(form.errors, { dataVar: 'champs' })}`);
    const at = this.iso();
    record.fields = fields;
    record.documents.push(...(await this.takeUploads(tx, record.id, applicantRef, input.documents, procedure, at)));
    this.updateStep(record, this.currentInformationStep(record), { state: 'done', actor: 'applicant', at });
    record.steps.push(step(`response-${this.responseCount(record) + 1}`, "Complément fourni par l'usager", 'done', 'applicant', at, input.message));
    record.informationRequest = null;
    record.status = 'in_review';
    record.updatedAt = at;
    await this.log(tx, record, 'applicant', null, 'information.provided', null, at);
    await this.saveCase(tx, record);
    return record;
  }

  async act(tx: Tx, official: Official, caseId: string, action: CaseAction, note: string | null): Promise<Case> {
    const record = await this.lockCase(tx, { kind: 'official', official }, caseId);
    const at = this.iso();
    const reason = note?.trim() || null;
    switch (action) {
      case 'claim':
        if ((record.status !== 'received' && record.status !== 'in_review') || record.claimedBy) throw invalidTransition('Ce dossier ne peut pas être pris en charge');
        record.status = 'in_review';
        record.claimedBy = official.id;
        record.steps.push(step('claim', `Pris en charge par ${official.displayName}`, 'done', 'administration', at));
        await this.log(tx, record, 'administration', official.id, 'case.claimed', null, at);
        break;
      case 'request_information':
        if (!reason) throw invalid('Motif obligatoire pour demander un complément');
        if (record.status !== 'in_review') throw invalidTransition("Ce dossier n'est pas en cours d'instruction");
        record.status = 'information_requested';
        record.claimedBy ??= official.id;
        record.informationRequest = { note: reason, requestedAt: at, requestedBy: official.id };
        record.steps.push(step(`information-${this.informationCount(record) + 1}`, "Complément demandé à l'usager", 'pending', 'applicant', at, reason));
        await this.log(tx, record, 'administration', official.id, 'information.requested', reason, at);
        break;
      case 'approve':
        if (record.status !== 'in_review') throw invalidTransition("Ce dossier n'attend pas de décision");
        for (const blocked of record.steps.filter((candidate) => candidate.state === 'blocked')) {
          Object.assign(blocked, { state: 'done', actor: 'administration', note: `Vérifié par ${official.displayName}`, at });
        }
        this.updateStep(record, 'decision', { state: 'done', note: reason ?? 'Dossier approuvé', at });
        record.status = 'completed';
        record.completedBy = 'administration';
        record.claimedBy ??= official.id;
        record.decisionNote = reason;
        await this.log(tx, record, 'administration', official.id, 'case.approved', reason, at);
        await this.issue(tx, record, this.ruleOf(record), at, 'administration', official.id);
        break;
      case 'reject':
        if (!reason) throw invalid('Motif obligatoire pour rejeter un dossier');
        if (record.status !== 'in_review' && record.status !== 'information_requested') throw invalidTransition("Ce dossier n'attend pas de décision");
        for (const open of record.steps.filter((candidate) => candidate.id !== 'decision' && candidate.state !== 'done')) {
          Object.assign(open, { state: 'done', actor: 'administration', note: `Dossier rejeté par ${official.displayName}`, at });
        }
        this.updateStep(record, 'decision', { state: 'done', note: reason, at });
        record.status = 'rejected';
        record.informationRequest = null;
        record.claimedBy ??= official.id;
        record.decisionNote = reason;
        await this.log(tx, record, 'administration', official.id, 'case.rejected', reason, at);
        break;
    }
    record.updatedAt = at;
    await this.saveCase(tx, record);
    return record;
  }

  async document(tx: Tx, caller: Caller, caseId: string, documentId: string): Promise<{ mimeType: UploadMime; content: Buffer }> {
    const record = await this.getCase(tx, caller, caseId);
    const document = record.documents.find((candidate) => candidate.id === documentId);
    if (!document) throw notFound('Document inconnu');
    const [row] = await tx.query<{ content: Uint8Array }>('select content from xroad_documents where id = $1 and case_id = $2', [documentId, caseId]);
    if (!row) throw notFound('Document inconnu');
    return { mimeType: document.mimeType, content: Buffer.from(row.content) };
  }

  async officialBySubject(tx: Tx, subject: string): Promise<Official | undefined> {
    const [row] = await tx.query<{ body: Official }>('select body from xroad_officials where subject = $1', [subject]);
    return row?.body;
  }

  me(official: Official): Schemas['Me'] {
    return {
      official,
      administration: official.administrationId ? (this.administrations.get(official.administrationId) ?? null) : null,
      permissions: PERMISSIONS[official.role],
    };
  }

  async updateProfile(tx: Tx, official: Official, input: Schemas['ProfileUpdate']): Promise<Official> {
    return this.saveOfficial(tx, { ...official, displayName: input.displayName, jobTitle: input.jobTitle });
  }

  async setAvatar(tx: Tx, official: Official, avatarUrl: string): Promise<Official> {
    return this.saveOfficial(tx, { ...official, avatarUrl });
  }

  async listOfficials(tx: Tx, viewer: Official, administrationId: string | undefined, page: Page): Promise<{ items: Official[]; hasMore: boolean }> {
    if (viewer.role === 'agent') return { items: page.offset === 0 ? [viewer] : [], hasMore: false };
    const scope = this.scopeOf(viewer, administrationId);
    const rows = await tx.query<{ body: Official }>(
      `select body from xroad_officials ${scope === null ? '' : 'where administration_id = $1'} order by id limit ${page.limit + 1} offset ${page.offset}`,
      scope === null ? [] : [scope],
    );
    return { items: rows.slice(0, page.limit).map((row) => row.body), hasMore: rows.length > page.limit };
  }

  async createOfficial(tx: Tx, viewer: Official, input: Schemas['OfficialRegistration']): Promise<Official> {
    if (viewer.role !== 'super_admin') throw forbidden('Création réservée au super administrateur');
    this.assertAssignment(input.administrationId, input.role);
    const [taken] = await tx.query('select id from xroad_officials where subject = $1 or email = $2', [input.subject, input.email]);
    if (taken) throw new ProblemError(409, 'CONFLICT', 'Cette personne est déjà inscrite');
    const official: Official = { id: newId('off', this.now()), ...input, avatarUrl: null, active: true };
    await tx.query(
      'insert into xroad_officials (id, subject, email, administration_id, role, body) values ($1, $2, $3, $4, $5, $6::jsonb)',
      [official.id, official.subject, official.email, official.administrationId, official.role, JSON.stringify(official)],
    );
    return official;
  }

  async updateOfficial(tx: Tx, viewer: Official, officialId: string, input: Schemas['OfficialUpdate']): Promise<Official> {
    if (viewer.role === 'agent') throw forbidden('Gestion des agents non autorisée');
    const [row] = await tx.query<{ body: Official }>('select body from xroad_officials where id = $1 for update', [officialId]);
    if (!row) throw notFound('Agent inconnu');
    const target = row.body;
    if (viewer.role === 'admin') {
      if (target.administrationId !== viewer.administrationId) throw notFound('Agent inconnu');
      if (input.administrationId !== viewer.administrationId || input.role === 'super_admin') throw forbidden("Un administrateur n'agit que dans son administration");
    }
    this.assertAssignment(input.administrationId, input.role);
    if (target.role === 'super_admin' && (input.role !== 'super_admin' || !input.active)) {
      const [count] = await tx.query<{ total: string }>("select count(*) as total from xroad_officials where role = 'super_admin' and (body->>'active')::boolean");
      if (Number(count.total) <= 1) throw new ProblemError(409, 'CONFLICT', 'Impossible de retirer le dernier super administrateur');
    }
    return this.saveOfficial(tx, { ...target, administrationId: input.administrationId, role: input.role, active: input.active });
  }

  async metrics(tx: Tx, official: Official, administrationId: string | undefined, from: string | undefined, to: string | undefined): Promise<Schemas['Metrics']> {
    const scope = this.scopeOf(official, administrationId);
    const end = to ?? this.iso();
    const start = from ?? new Date(Date.parse(end) - DEFAULT_PERIOD).toISOString();
    if (Date.parse(start) > Date.parse(end)) throw invalid('from doit précéder to');
    const params: unknown[] = [new Date(start), new Date(end)];
    if (scope !== null) params.push(scope);
    const rows = await tx.query<{ body: Case }>(
      `select body from xroad_cases where created_at between $1 and $2 ${scope === null ? '' : 'and administration_id = $3'}`,
      params,
    );
    // A case awaiting payment has not reached the administration yet.
    const cases = rows.map((row) => row.body).filter((record) => record.status !== 'awaiting_payment');
    const closed = cases.filter((record) => record.status === 'completed' || record.status === 'rejected');
    const durations = closed.map((record) => (Date.parse(record.updatedAt) - Date.parse(record.createdAt)) / HOUR).sort((a, b) => a - b);
    const counts = new Map<string, number>();
    for (const record of cases) counts.set(record.procedureId, (counts.get(record.procedureId) ?? 0) + 1);
    return {
      administrationId: scope,
      period: { from: start, to: end },
      received: cases.length,
      pending: cases.filter((record) => PENDING_STATUSES.includes(record.status)).length,
      informationRequested: cases.filter((record) => record.status === 'information_requested').length,
      completed: cases.filter((record) => record.status === 'completed').length,
      completedByAssistant: cases.filter((record) => record.completedBy === 'assistant').length,
      rejected: cases.filter((record) => record.status === 'rejected').length,
      medianProcessingHours: durations.length ? Math.round(median(durations) * 10) / 10 : null,
      byChannel: CHANNELS.map((channel) => ({ channel, count: cases.filter((record) => record.channel === channel).length })),
      topProcedures: [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([procedureId, count]) => ({ procedureId, title: this.getProcedure(procedureId).title, count })),
    };
  }

  async activity(tx: Tx, official: Official, administrationId: string | undefined, caseId: string | undefined, page: Page): Promise<{ items: ActivityEntry[]; hasMore: boolean }> {
    const scope = this.scopeOf(official, administrationId);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (scope !== null) {
      params.push(scope);
      clauses.push(`administration_id = $${params.length}`);
    }
    if (caseId) {
      params.push(caseId);
      clauses.push(`case_id = $${params.length}`);
    }
    const rows = await tx.query<{ body: ActivityEntry }>(
      `select body from xroad_activity ${clauses.length ? `where ${clauses.join(' and ')}` : ''} order by seq desc limit ${page.limit + 1} offset ${page.offset}`,
      params,
    );
    return { items: rows.slice(0, page.limit).map((row) => row.body), hasMore: rows.length > page.limit };
  }

  /** Counts per administration, for the overview page: no personal data. */
  async overview(tx: Tx): Promise<Map<string, { total: number; pending: number; byAssistant: number }>> {
    const rows = await tx.query<{ administration_id: string; total: string; pending: string; by_assistant: string }>(
      `select administration_id, count(*) as total,
         count(*) filter (where status = any($1)) as pending,
         count(*) filter (where body->>'completedBy' = 'assistant') as by_assistant
       from xroad_cases group by administration_id`,
      [PENDING_STATUSES],
    );
    return new Map(rows.map((row) => [row.administration_id, { total: Number(row.total), pending: Number(row.pending), byAssistant: Number(row.by_assistant) }]));
  }

  private assertAssignment(administrationId: string | null, role: Official['role']): void {
    if ((role === 'super_admin') !== (administrationId === null)) {
      throw invalid('Un super administrateur n’a pas d’administration ; les autres rôles en exigent une');
    }
    if (administrationId !== null && !this.administrations.has(administrationId)) throw invalid('Administration inconnue');
  }

  private async saveOfficial(tx: Tx, official: Official): Promise<Official> {
    await tx.query('update xroad_officials set administration_id = $2, role = $3, body = $4::jsonb where id = $1', [
      official.id,
      official.administrationId,
      official.role,
      JSON.stringify(official),
    ]);
    return official;
  }

  private async lockCase(tx: Tx, caller: Caller, caseId: string): Promise<Case> {
    const [row] = await tx.query<{ body: Case }>('select body from xroad_cases where id = $1 for update', [caseId]);
    if (!row || !this.canSee(caller, row.body)) throw notFound('Dossier inconnu');
    return row.body;
  }

  private async saveCase(tx: Tx, record: Case): Promise<void> {
    await tx.query('update xroad_cases set status = $2, updated_at = $3, body = $4::jsonb where id = $1', [
      record.id,
      record.status,
      new Date(record.updatedAt),
      JSON.stringify(record),
    ]);
  }

  /** Moves uploaded pieces into the case. An upload of another applicant, expired or already used, does not exist. */
  private async takeUploads(tx: Tx, caseId: string, applicantRef: string, references: DocumentRef[], procedure: Procedure, at: string): Promise<CaseDocument[]> {
    const documents: CaseDocument[] = [];
    for (const reference of references) {
      const [upload] = await tx.query<{ mime_type: UploadMime; size_bytes: number; content: Uint8Array }>(
        'delete from xroad_uploads where id = $1 and applicant_ref = $2 and expires_at > $3 returning mime_type, size_bytes, content',
        [reference.uploadId, applicantRef, new Date(this.now())],
      );
      if (!upload) throw notFound('Pièce inconnue ou expirée');
      const label = procedure.filing?.requiredDocuments.find((required) => required.documentType === reference.documentType)?.label;
      const document: CaseDocument = {
        id: newId('doc', this.now()),
        kind: 'submitted',
        documentType: reference.documentType,
        name: label ?? 'Pièce complémentaire',
        mimeType: upload.mime_type,
        sizeBytes: upload.size_bytes,
        createdAt: at,
      };
      await tx.query('insert into xroad_documents (id, case_id, content) values ($1, $2, $3)', [document.id, caseId, Buffer.from(upload.content)]);
      documents.push(document);
    }
    return documents;
  }

  /** Administration an official may look at: their own, or any (null = all) for the super admin. */
  private scopeOf(official: Official, administrationId: string | undefined): string | null {
    if (official.role === 'super_admin') return administrationId ?? null;
    if (administrationId && administrationId !== official.administrationId) throw forbidden('Administration hors de votre périmètre');
    return official.administrationId;
  }

  private canSee(caller: Caller, record: Case): boolean {
    if (caller.kind === 'applicant') return record.applicantRef === caller.applicantRef;
    return caller.official.role === 'super_admin' || caller.official.administrationId === record.administrationId;
  }

  /** Automatic instruction: the assistant either completes the case, or stops on a blocked check. */
  private async instruct(tx: Tx, record: Case, rule: InstructionRule): Promise<void> {
    const at = this.iso();
    if (rule.blocker === null) {
      record.steps.push(step('check', rule.check, 'done', 'assistant', at));
      await this.log(tx, record, 'assistant', null, 'step.completed', rule.check, at);
      record.status = 'completed';
      record.completedBy = 'assistant';
      await this.issue(tx, record, rule, at, 'assistant', null);
    } else {
      record.steps.push(step('check', rule.check, 'blocked', 'assistant', at, rule.blocker));
      record.steps.push(step('decision', "Décision de l'administration", 'pending', 'administration', null));
      await this.log(tx, record, 'assistant', null, 'step.completed', rule.blocker, at);
      record.status = 'in_review';
    }
    record.updatedAt = at;
  }

  private async issue(tx: Tx, record: Case, rule: InstructionRule, at: string, actor: CaseStep['actor'], officialId: string | null): Promise<void> {
    if (!rule.issues) return;
    const name = `${rule.issues} (simulation)`;
    const administration = this.administrations.get(record.administrationId)?.name ?? record.administrationId;
    const content = simulatedPdf(name, [
      `Référence du dossier : ${record.reference}`,
      `Démarche : ${record.title}`,
      `Administration : ${administration}`,
      `Délivré le : ${at.slice(0, 10)}`,
      'Document produit par le X-Road simulé du projet Assistant-démarches.',
    ]);
    const id = newId('doc', Date.parse(at));
    await tx.query('insert into xroad_documents (id, case_id, content) values ($1, $2, $3)', [id, record.id, content]);
    record.documents.push({ id, kind: 'issued', documentType: ISSUED_DOCUMENT_TYPE, name, mimeType: 'application/pdf', sizeBytes: content.length, createdAt: at });
    record.steps.push(step('issue', `${rule.issues} délivré`, 'done', actor, at));
    await this.log(tx, record, actor, officialId, 'document.issued', name, at);
  }

  private async log(tx: Tx, record: Case, actor: ActivityEntry['actor'], officialId: string | null, action: ActivityEntry['action'], note: string | null, at: string): Promise<void> {
    const entry: ActivityEntry = {
      id: newId('act', Date.parse(at)),
      caseId: record.id,
      caseReference: record.reference,
      administrationId: record.administrationId,
      actor,
      officialId,
      action,
      note,
      at,
    };
    await tx.query('insert into xroad_activity (case_id, administration_id, body) values ($1, $2, $3::jsonb)', [record.id, record.administrationId, JSON.stringify(entry)]);
  }

  private ruleOf(record: Case): InstructionRule {
    const entry = this.catalogue.get(record.procedureId);
    if (!entry?.rule) throw new Error(`Démarche disparue du catalogue : ${record.procedureId}`);
    return entry.rule;
  }

  private updateStep(record: Case, id: string, patch: Partial<CaseStep>): void {
    const found = record.steps.find((candidate) => candidate.id === id);
    if (found) Object.assign(found, patch);
  }

  private informationCount(record: Case): number {
    return record.steps.filter((candidate) => candidate.id.startsWith('information-')).length;
  }

  private responseCount(record: Case): number {
    return record.steps.filter((candidate) => candidate.id.startsWith('response-')).length;
  }

  private currentInformationStep(record: Case): string {
    return `information-${this.informationCount(record)}`;
  }

  private formValidator(procedure: Procedure): ValidateFunction {
    let validate = this.forms.get(procedure.id);
    if (!validate) {
      validate = ajv.compile(procedure.filing?.formSchema ?? {});
      this.forms.set(procedure.id, validate);
    }
    return validate;
  }

  private async nextReference(tx: Tx, code: string): Promise<string> {
    const key = `${code}-${new Date(this.now()).getUTCFullYear()}`;
    const [row] = await tx.query<{ value: number }>(
      `insert into xroad_sequences (key, value) values ($1, 1)
       on conflict (key) do update set value = xroad_sequences.value + 1 returning value`,
      [key],
    );
    return `SIM-${key}-${String(row.value).padStart(6, '0')}`;
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }
}

/** Words that say what the citizen wants to do rather than which procedure: they would match half the catalogue. */
const STOP_WORDS = new Set(
  ('au aux avec ce ces comment dans de des du elle en est et faire il je la le les leur ma mes moi mon nos notre ou par pour quel quelle ' +
    'quels quelles qui quoi sa ses son sur ta tes ton une un vos votre obtenir avoir demande demander besoin veux voudrais peux puis doit ' +
    'dois faut comme cette mais plus tout tous etre suis sont')
    .split(' '),
);

/** Lowercase, no accents, no stop words, cut to a 6-letter stem ("renouveler" and "renouvellement" meet). */
export function searchTerms(text: string): string[] {
  return text
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
    .map((word) => word.slice(0, 6));
}

function step(id: string, label: string, state: CaseStep['state'], actor: CaseStep['actor'], at: string | null, note: string | null = null): CaseStep {
  return { id, label, state, actor, note, at };
}

function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export type { FieldValue };
