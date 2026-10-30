import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import { ajv } from './contracts.js';
import {
  ADMINISTRATIONS,
  CATALOGUE,
  OFFICIALS,
  type Administration,
  type Case,
  type CaseDocument,
  type CaseStep,
  type FieldValue,
  type InstructionRule,
  type Official,
  type OfficialRole,
  type Procedure,
} from './data.js';
import { newId } from './ids.js';
import { ProblemError, forbidden, invalid, notFound } from './problem.js';

export type Caller = { kind: 'applicant'; applicantRef: string } | { kind: 'official'; official: Official };
export type Decider = { kind: 'official'; official: Official } | { kind: 'console'; actorRef: string };

export interface StoredReply {
  fingerprint: string;
  reply: { status: number; body: unknown; type?: string };
}

interface PersistedState {
  version: 1;
  cases: Case[];
  sequences: [string, number][];
  officials: Official[];
  replies: [string, StoredReply][];
}
export type CaseView = 'pending' | 'completed' | 'all';

export interface CaseInput {
  requestId: string;
  procedureId: string;
  fields: Record<string, FieldValue>;
  documents: CaseDocument[];
}

export interface Metrics {
  administrationId: string | null;
  casesTotal: number;
  casesPending: number;
  casesCompleted: number;
  casesCompletedByAssistant: number;
  casesRejected: number;
  medianProcessingHours: number | null;
  topProcedures: { procedureId: string; title: string; count: number }[];
}

const HOUR = 3600 * 1000;
type HistoricOutcome = 'assistant' | 'pending' | 'administration' | 'rejected';
// Outcomes cycled through for procedures that need an official, so every dashboard state shows up.
const REVIEW_OUTCOMES: HistoricOutcome[] = ['pending', 'administration', 'pending', 'rejected', 'administration'];
const MAX_REPLIES = 10_000;

export class XroadStore {
  private readonly administrations = new Map(ADMINISTRATIONS.map((administration) => [administration.id, administration]));
  private readonly catalogue = new Map(CATALOGUE.map((entry) => [entry.procedure.id, entry]));
  private readonly officials = new Map(OFFICIALS.map((official) => [official.id, { ...official }]));
  private readonly cases = new Map<string, Case>();
  private readonly casesByRequest = new Map<string, string>();
  private readonly sequences = new Map<string, number>();
  private readonly forms = new Map<string, ValidateFunction>();
  private readonly replies = new Map<string, StoredReply>();
  private readonly now: () => number;
  private readonly stateFile?: string;

  constructor(options: { seedHistory: boolean; now?: () => number; stateFile?: string }) {
    this.now = options.now ?? Date.now;
    this.stateFile = options.stateFile;
    if (this.stateFile && existsSync(this.stateFile)) {
      this.load(this.stateFile);
      return;
    }
    if (options.seedHistory) this.seedHistory();
    this.save();
  }

  recall(scope: string): StoredReply | undefined {
    return this.replies.get(scope);
  }

  remember(scope: string, stored: StoredReply): void {
    this.replies.set(scope, stored);
    if (this.replies.size > MAX_REPLIES) this.replies.delete(this.replies.keys().next().value as string);
    this.save();
  }

  listAdministrations(): Administration[] {
    return [...this.administrations.values()];
  }

  /**
   * Ranked search over the official sheets: a citizen's question ("comment renouveler mon passeport") must find the sheet
   * even when its words differ ("renouvellement"). Title matches weigh more; sheets covering fewer than half of the best
   * sheet's terms are dropped. No query: the whole catalogue in its order.
   */
  searchProcedures(query: string | undefined, administrationId: string | undefined): Procedure[] {
    const procedures = [...this.catalogue.values()]
      .map((entry) => entry.procedure)
      .filter((procedure) => !administrationId || procedure.administrationId === administrationId);
    const terms = [...new Set(searchTerms(query ?? ''))];
    if (terms.length === 0) return query?.trim() ? [] : procedures;
    const scored = procedures
      .map((procedure) => {
        const title = new Set(searchTerms(procedure.title));
        const body = new Set(searchTerms(`${procedure.summary} ${procedure.official.authority ?? ''}`));
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

  official(officialId: string): Official {
    const official = this.officials.get(officialId);
    if (!official) throw forbidden('Agent inconnu de la simulation');
    return official;
  }

  createCase(applicantRef: string, input: CaseInput): Case {
    const entry = this.catalogue.get(input.procedureId);
    if (!entry) throw notFound('Démarche inconnue');
    const { procedure, rule } = entry;
    if (!rule) throw new ProblemError(409, 'INVALID_TRANSITION', `Dépôt par l'assistant non disponible pour cette démarche : voir la fiche officielle ${procedure.source.url}`);
    if (this.administrations.get(procedure.administrationId)?.connection.status !== 'connected') {
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', "Administration non connectée à X-Road : dépôt impossible, connexion recommandée");
    }
    if (this.casesByRequest.has(input.requestId)) throw new ProblemError(409, 'INVALID_TRANSITION', 'Demande déjà déposée');

    const form = this.formValidator(procedure);
    if (!form(input.fields)) throw new ProblemError(409, 'REQUEST_INCOMPLETE', `Formulaire incomplet : ${ajv.errorsText(form.errors, { dataVar: 'champs' })}`);
    const provided = new Set(input.documents.map((document) => document.documentType));
    const missing = procedure.requiredDocuments.filter((type) => !provided.has(type));
    if (missing.length) throw new ProblemError(409, 'REQUEST_INCOMPLETE', `Pièces manquantes : ${missing.join(', ')}`);

    const at = this.iso();
    const fee = (procedure.feeFcfa ?? 0) > 0;
    const record: Case = {
      id: newId('cas', this.now()),
      reference: this.nextReference(rule.code),
      simulated: true,
      procedureId: procedure.id,
      administrationId: procedure.administrationId,
      requestId: input.requestId,
      applicantRef,
      status: fee ? 'awaiting_payment' : 'received',
      fields: { ...input.fields },
      documents: input.documents.map((document) => ({ ...document })),
      payment: { amountFcfa: procedure.feeFcfa ?? 0, status: fee ? 'pending' : 'not_required', method: null, reference: null, paidAt: null },
      steps: [
        step('form', "Formulaire complété avec l'assistant", 'done', 'assistant', at),
        step('documents', 'Pièces transmises', 'done', 'assistant', at),
        ...(fee ? [step('payment', `Frais de ${procedure.feeFcfa} FCFA à régler`, 'pending', 'applicant', null)] : []),
      ],
      issuedDocuments: [],
      completedBy: null,
      createdAt: at,
      updatedAt: at,
    };
    this.cases.set(record.id, record);
    this.casesByRequest.set(record.requestId, record.id);
    if (record.status === 'received') this.instruct(record, rule);
    this.save();
    return record;
  }

  getCase(caller: Caller, caseId: string): Case {
    const record = this.cases.get(caseId);
    if (!record || !this.canSee(caller, record)) throw notFound('Dossier inconnu');
    return record;
  }

  pay(applicantRef: string, caseId: string): Case {
    const record = this.getCase({ kind: 'applicant', applicantRef }, caseId);
    if (record.status !== 'awaiting_payment') throw new ProblemError(409, 'INVALID_TRANSITION', 'Aucun paiement attendu pour ce dossier');
    const at = this.iso();
    record.payment = { ...record.payment, status: 'paid', method: 'mobile_money', reference: `SIM-PAY-${record.reference.slice(-6)}`, paidAt: at };
    this.updateStep(record, 'payment', { label: `Frais de ${record.payment.amountFcfa} FCFA réglés par Mobile Money (simulation)`, state: 'done', at });
    record.status = 'received';
    record.updatedAt = at;
    this.instruct(record, this.ruleOf(record));
    this.save();
    return record;
  }

  decide(decider: Decider, caseId: string, decision: 'approve' | 'reject', note: string | null): Case {
    const record = decider.kind === 'official' ? this.getCase(decider, caseId) : this.cases.get(caseId);
    if (!record) throw notFound('Dossier inconnu');
    if (record.status !== 'in_review') throw new ProblemError(409, 'INVALID_TRANSITION', "Ce dossier n'attend pas de décision");
    const at = this.iso();
    const verifier = decider.kind === 'official' ? decider.official.displayName : "un agent du ministère, depuis la console d'administration";
    if (decision === 'approve') {
      for (const blocked of record.steps.filter((candidate) => candidate.state === 'blocked')) {
        Object.assign(blocked, { state: 'done', actor: 'administration', note: `Vérifié par ${verifier}`, at });
      }
      this.updateStep(record, 'decision', { state: 'done', note: note ?? 'Dossier approuvé', at });
      this.issue(record, this.ruleOf(record), at);
      record.status = 'completed';
      record.completedBy = 'administration';
    } else {
      this.updateStep(record, 'decision', { state: 'done', note: note ?? 'Dossier rejeté', at });
      record.status = 'rejected';
    }
    record.updatedAt = at;
    this.save();
    return record;
  }

  listCases(official: Official, administrationId: string | undefined, view: CaseView): Case[] {
    const scope = this.scopeOf(official, administrationId);
    const selected = [...this.cases.values()].filter(
      (record) =>
        (scope === null || record.administrationId === scope) &&
        (view === 'all' || (view === 'pending' ? record.status === 'in_review' : record.status === 'completed')),
    );
    // Pending work: oldest first, so nothing waits for weeks at the bottom of the list.
    return selected.sort((a, b) => (view === 'pending' ? a.createdAt.localeCompare(b.createdAt) : b.updatedAt.localeCompare(a.updatedAt)));
  }

  issuedDocument(caller: Caller, caseId: string, documentId: string): { record: Case; title: string; issuedAt: string } {
    const record = this.getCase(caller, caseId);
    const document = record.issuedDocuments.find((candidate) => candidate.id === documentId);
    if (!document) throw notFound('Document inconnu');
    return { record, title: document.title, issuedAt: document.issuedAt };
  }

  listOfficials(viewer: Official | undefined, administrationId: string | undefined): Official[] {
    const all = [...this.officials.values()];
    if (!viewer) return all.filter((official) => !administrationId || official.administrationId === administrationId);
    if (viewer.role === 'agent') return [viewer];
    const scope = this.scopeOf(viewer, administrationId);
    return all.filter((official) => scope === null || official.administrationId === scope);
  }

  assign(viewer: Official, officialId: string, administrationId: string | null, role: OfficialRole): Official {
    if (viewer.role !== 'super_admin') throw forbidden('Affectation réservée au super administrateur');
    const target = this.officials.get(officialId);
    if (!target) throw notFound('Agent inconnu');
    if ((role === 'super_admin') !== (administrationId === null)) {
      throw invalid('Un super administrateur n’a pas d’administration ; les autres rôles en exigent une');
    }
    if (administrationId !== null && !this.administrations.has(administrationId)) throw invalid('Administration inconnue');
    const superAdmins = [...this.officials.values()].filter((official) => official.role === 'super_admin');
    if (target.role === 'super_admin' && role !== 'super_admin' && superAdmins.length === 1) {
      throw new ProblemError(409, 'INVALID_TRANSITION', 'Impossible de retirer le dernier super administrateur');
    }
    Object.assign(target, { administrationId, role });
    this.save();
    return target;
  }

  metrics(official: Official, administrationId: string | undefined): Metrics {
    const scope = this.scopeOf(official, administrationId);
    const cases = [...this.cases.values()].filter((record) => scope === null || record.administrationId === scope);
    const closed = cases.filter((record) => record.status === 'completed' || record.status === 'rejected');
    const durations = closed.map((record) => (Date.parse(record.updatedAt) - Date.parse(record.createdAt)) / HOUR).sort((a, b) => a - b);
    const counts = new Map<string, number>();
    for (const record of cases) counts.set(record.procedureId, (counts.get(record.procedureId) ?? 0) + 1);
    return {
      administrationId: scope,
      casesTotal: cases.length,
      casesPending: cases.filter((record) => record.status === 'in_review').length,
      casesCompleted: cases.filter((record) => record.status === 'completed').length,
      casesCompletedByAssistant: cases.filter((record) => record.completedBy === 'assistant').length,
      casesRejected: cases.filter((record) => record.status === 'rejected').length,
      medianProcessingHours: durations.length ? Math.round(median(durations) * 10) / 10 : null,
      topProcedures: [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([procedureId, count]) => ({ procedureId, title: this.getProcedure(procedureId).title, count })),
    };
  }

  private save(): void {
    if (!this.stateFile) return;
    const state: PersistedState = {
      version: 1,
      cases: [...this.cases.values()],
      sequences: [...this.sequences.entries()],
      officials: [...this.officials.values()],
      replies: [...this.replies.entries()],
    };
    const temporary = `${this.stateFile}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(state));
    renameSync(temporary, this.stateFile);
  }

  private load(file: string): void {
    const state = JSON.parse(readFileSync(file, 'utf8')) as PersistedState;
    if (state.version !== 1 || !Array.isArray(state.cases) || !Array.isArray(state.officials)) throw new Error(`État du X-Road illisible : ${file}`);
    for (const record of state.cases) {
      this.cases.set(record.id, record);
      this.casesByRequest.set(record.requestId, record.id);
    }
    for (const [key, value] of state.sequences) this.sequences.set(key, value);
    for (const official of state.officials) if (this.officials.has(official.id)) this.officials.set(official.id, official);
    for (const [scope, stored] of state.replies) this.replies.set(scope, stored);
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
  private instruct(record: Case, rule: InstructionRule): void {
    const at = this.iso();
    if (rule.blocker === null) {
      record.steps.push(step('check', rule.check, 'done', 'assistant', at));
      this.issue(record, rule, at);
      record.status = 'completed';
      record.completedBy = 'assistant';
    } else {
      record.steps.push(step('check', rule.check, 'blocked', 'assistant', at, rule.blocker));
      record.steps.push(step('decision', "Décision de l'administration", 'pending', 'administration', null));
      record.status = 'in_review';
    }
    record.updatedAt = at;
  }

  private issue(record: Case, rule: InstructionRule, at: string): void {
    if (!rule.issues) return;
    record.issuedDocuments.push({ id: newId('doc', Date.parse(at)), title: `${rule.issues} (simulation)`, mimeType: 'application/pdf', issuedAt: at });
    record.steps.push(step('issue', `${rule.issues} délivré`, 'done', record.status === 'in_review' ? 'administration' : 'assistant', at));
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

  private formValidator(procedure: Procedure): ValidateFunction {
    let validate = this.forms.get(procedure.id);
    if (!validate) {
      validate = ajv.compile(procedure.formSchema);
      this.forms.set(procedure.id, validate);
    }
    return validate;
  }

  private nextReference(code: string, at = this.now()): string {
    const year = new Date(at).getUTCFullYear();
    const key = `${code}-${year}`;
    const next = (this.sequences.get(key) ?? 0) + 1;
    this.sequences.set(key, next);
    return `SIM-${key}-${String(next).padStart(6, '0')}`;
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  /** A few weeks of fictitious activity so dashboards are not empty at the start of a demo. */
  private seedHistory(): void {
    let state = 20261029;
    const random = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const end = this.now();
    for (const { procedure, rule } of this.catalogue.values()) {
      if (!rule) continue;
      const total = 4 + Math.floor(random() * 6);
      for (let n = 0; n < total; n += 1) {
        const createdAt = end - Math.floor((1 + random() * 20) * 24) * HOUR;
        const outcome = rule.blocker === null ? 'assistant' : REVIEW_OUTCOMES[n % REVIEW_OUTCOMES.length];
        const record = this.historicCase(procedure, rule, createdAt, outcome, random);
        this.cases.set(record.id, record);
        this.casesByRequest.set(record.requestId, record.id);
      }
    }
  }

  private historicCase(procedure: Procedure, rule: InstructionRule, createdAtMs: number, outcome: HistoricOutcome, random: () => number): Case {
    const createdAt = new Date(createdAtMs).toISOString();
    const closedAt = new Date(createdAtMs + Math.floor(1 + random() * 72) * HOUR).toISOString();
    const reference = this.nextReference(rule.code, createdAtMs);
    const paid = (procedure.feeFcfa ?? 0) > 0;
    const steps: CaseStep[] = [
      step('form', "Formulaire complété avec l'assistant", 'done', 'assistant', createdAt),
      step('documents', 'Pièces transmises', 'done', 'assistant', createdAt),
      ...(paid ? [step('payment', `Frais de ${procedure.feeFcfa} FCFA réglés par Mobile Money (simulation)`, 'done', 'applicant', createdAt)] : []),
    ];
    const issuedDocuments: Case['issuedDocuments'] = [];
    if (outcome === 'pending') {
      steps.push(step('check', rule.check, 'blocked', 'assistant', createdAt, rule.blocker), step('decision', "Décision de l'administration", 'pending', 'administration', null));
    } else {
      const checker = outcome === 'assistant' ? 'assistant' : 'administration';
      steps.push(step('check', rule.check, 'done', checker, createdAt, outcome === 'assistant' ? null : 'Vérifié par un agent (simulation)'));
      if (outcome !== 'assistant') steps.push(step('decision', "Décision de l'administration", 'done', 'administration', closedAt, outcome === 'rejected' ? 'Dossier rejeté' : 'Dossier approuvé'));
      if (outcome !== 'rejected' && rule.issues) {
        issuedDocuments.push({ id: newId('doc', Date.parse(closedAt)), title: `${rule.issues} (simulation)`, mimeType: 'application/pdf', issuedAt: closedAt });
        steps.push(step('issue', `${rule.issues} délivré`, 'done', checker, closedAt));
      }
    }
    return {
      id: newId('cas', createdAtMs),
      reference,
      simulated: true,
      procedureId: procedure.id,
      administrationId: procedure.administrationId,
      requestId: newId('cas', createdAtMs).replace('cas_', 'req_'),
      applicantRef: newId('cas', createdAtMs).replace('cas_', 'usr_'),
      status: outcome === 'pending' ? 'in_review' : outcome === 'rejected' ? 'rejected' : 'completed',
      fields: sampleFields(procedure.formSchema),
      documents: procedure.requiredDocuments.map((documentType) => ({
        documentType,
        fileId: newId('cas', createdAtMs).replace('cas_', 'fil_'),
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      })),
      payment: paid
        ? { amountFcfa: procedure.feeFcfa ?? 0, status: 'paid', method: 'mobile_money', reference: `SIM-PAY-${reference.slice(-6)}`, paidAt: createdAt }
        : { amountFcfa: 0, status: 'not_required', method: null, reference: null, paidAt: null },
      steps,
      issuedDocuments,
      completedBy: outcome === 'assistant' ? 'assistant' : outcome === 'administration' ? 'administration' : null,
      createdAt,
      updatedAt: outcome === 'pending' ? createdAt : closedAt,
    };
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

function sampleFields(formSchema: Record<string, unknown>): Record<string, FieldValue> {
  const properties = (formSchema.properties ?? {}) as Record<string, { enum?: string[]; type?: string; minimum?: number }>;
  return Object.fromEntries(
    Object.entries(properties).map(([name, schema]) => [name, schema.enum?.[0] ?? (schema.type === 'integer' ? (schema.minimum ?? 1) : 'Simulation')]),
  );
}
