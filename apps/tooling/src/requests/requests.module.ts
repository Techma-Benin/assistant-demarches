import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { canonicalJson, newId } from '../common/ids.js';
import { ConnectorRegistry, externalCaseOf } from '../connectors/connector.js';
import { ProblemError } from '../common/problem.js';
import { tools } from '../contracts.js';
import { MandatesRepository } from '../mandates/mandates.repository.js';
import { ToolRegistry, type PreparationContext, type ToolHandler, type ToolInvocation } from '../gateway/tool-registry.js';
import { ProcedureCatalog, ProceduresModule } from '../procedures/procedures.module.js';
import { BackendResourcesClient, type FileMetadata, type Procedure } from '../resources/backend-resources.client.js';
import { ResourcesModule } from '../resources/resources.module.js';
import { FormSchemas } from './form-schemas.js';
import { RequestWorkflow } from './request-workflow.js';
import { XroadClient, type XroadCase } from '../xroad/xroad.client.js';
import { RequestsRepository, toContract, type RequestField, type RequestRecord, type RequestStatus } from './requests.repository.js';

const EDITABLE: ReadonlySet<RequestStatus> = new Set(['draft', 'ready']);

interface Loaded {
  request: RequestRecord;
  procedure: Procedure;
}

interface Filing {
  formSchema: Record<string, unknown>;
  requiredDocuments: { documentType: string; label: string; acceptedMimeTypes?: string[] }[];
}

function filingOf(procedure: Procedure): Filing {
  const filing = procedure.filing as Filing | null | undefined;
  if (filing?.formSchema && Array.isArray(filing.requiredDocuments)) return filing;
  const types = Array.isArray(procedure.requiredDocuments) ? (procedure.requiredDocuments as string[]) : [];
  return {
    formSchema: (procedure.formSchema as Record<string, unknown>) ?? { type: 'object', properties: {}, required: [] },
    requiredDocuments: types.map((documentType) => ({ documentType, label: documentType })),
  };
}

function fieldLabel(procedure: Procedure, name: string): string {
  const properties = (filingOf(procedure).formSchema as { properties?: Record<string, { title?: string }> }).properties ?? {};
  return properties[name]?.title ?? name;
}

function emptyDocuments(procedure: Procedure) {
  return filingOf(procedure).requiredDocuments.map((document) => ({
    documentType: document.documentType,
    label: document.label,
    fileId: null as string | null,
  }));
}

@Injectable()
class RequestTools implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly catalog: ProcedureCatalog,
    private readonly resources: BackendResourcesClient,
    private readonly requests: RequestsRepository,
    private readonly forms: FormSchemas,
    private readonly connectors: ConnectorRegistry,
    private readonly mandates: MandatesRepository,
    private readonly xroad: XroadClient,
    private readonly workflow: RequestWorkflow,
  ) {}

  onModuleInit(): void {
    const create: ToolHandler<Procedure> = {
      name: 'request.create',
      prepare: (args, call) => this.catalog.getFileable(args.procedureId as string, call.trace),
      run: (_args, call) => this.create(call),
    };
    const update: ToolHandler<Loaded> = {
      name: 'request.update',
      prepare: (args, call) => this.load(args.requestId as string, call),
      run: (args, call) => this.update(args.requestId as string, args.fields as { name: string; value: string | number | boolean | null; source: 'answer' | 'document' }[], call),
    };
    const attach: ToolHandler<Loaded & { file: FileMetadata }> = {
      name: 'documents.attach',
      prepare: async (args, call) => ({
        ...(await this.load(args.requestId as string, call)),
        file: await this.resources.getFile(args.fileId as string, call.context.userRef, call.trace),
      }),
      run: (args, call) => this.attach(args.requestId as string, args.fileId as string, args.documentType as string, call),
    };
    const submit: ToolHandler<Loaded & { files: Map<string, FileMetadata> }> = {
      name: 'request.submit',
      prepare: async (args, call) => {
        const loaded = await this.load(args.requestId as string, call);
        const files = new Map<string, FileMetadata>();
        for (const { fileId } of loaded.request.documents) {
          if (fileId) files.set(fileId, await this.resources.getFile(fileId, call.context.userRef, call.trace));
        }
        return { ...loaded, files };
      },
      run: (args, call) => this.submit(args.requestId as string, call),
    };
    const pay: ToolHandler<{ request: RequestRecord; paid: XroadCase }> = {
      name: 'request.pay',
      prepare: (args, call) => this.pay(args.requestId as string, call),
      run: async (_args, call) => {
        const { request, paid } = call.prepared;
        await call.requireMandate(request.procedureId);
        const state = externalCaseOf(paid);
        const before = await this.workflow.load(call.tx, request.id, true);
        if (canonicalJson(before.external_state) !== canonicalJson(state)) {
          await this.requests.recordExternal(call.tx, request.id, state);
        }
        call.emit({ kind: 'case.updated', conversationId: request.conversationId, case: paid });
        return paid;
      },
    };
    const caseStatus: ToolHandler = {
      name: 'case.status',
      run: async (args, call) => {
        const request = await this.requests.findOwned(call.tx, args.requestId as string, call.context);
        if (!request.caseId) throw new ProblemError(409, 'INVALID_TRANSITION', 'Demande non déposée');
        return this.xroad.getCase(call.context.userRef, request.caseId, request.id, call.trace);
      },
    };
    const respond: ToolHandler<Loaded> = {
      name: 'case.respond',
      prepare: (args, call) => this.load(args.requestId as string, call),
      run: async (args, call) => {
        await call.requireMandate(call.prepared.request.procedureId);
        const request = call.prepared.request;
        if (!request.caseId) throw new ProblemError(409, 'INVALID_TRANSITION', 'Demande non déposée');
        return this.xroad.respond(call.context.userRef, request.caseId, request.id, {
          message: args.message as string,
          fields: (args.fields ?? {}) as Record<string, string | number | boolean | null>,
          documents: ((args.fileIds as { documentType: string; fileId: string }[]) ?? []).map((item) => ({ documentType: item.documentType, fileId: item.fileId })),
        }, call.trace);
      },
    };
    this.registry.register(create, update, attach, submit, pay, caseStatus, respond);
  }

  private async load(requestId: string, call: PreparationContext): Promise<Loaded> {
    const request = await call.read((tx) => this.requests.findOwned(tx, requestId, call.context));
    return { request, procedure: await this.catalog.get(request.procedureId, call.trace) };
  }

  private async create(call: ToolInvocation<Procedure>) {
    const procedure = call.prepared;
    await call.requireMandate(procedure.id);
    const filing = filingOf(procedure);
    const request = await this.requests.insert(call.tx, {
      id: newId('req'),
      conversationId: call.context.conversationId,
      userRef: call.context.userRef,
      procedureId: procedure.id,
      status: 'draft',
      fields: [],
      documents: emptyDocuments(procedure),
      missing: this.missingOf(procedure, [], emptyDocuments(procedure)),
    }, { administrationId: String(procedure.administrationId), title: String(procedure.title).slice(0, 200), processingDays: (filing as { processingDays?: number | null }).processingDays ?? (procedure.processingDays as number | null) ?? null });
    return toContract(this.withMissing(request, procedure));
  }

  private async update(requestId: string, fields: { name: string; value: string | number | boolean | null; source: 'answer' | 'document' }[], call: ToolInvocation<Loaded>) {
    const { procedure } = call.prepared;
    const request = await this.editable(requestId, call);
    const incoming = Object.fromEntries(fields.map((field) => [field.name, field.value]));
    const forbidden = this.forms.forbiddenField(incoming);
    if (forbidden) throw new ProblemError(400, 'INVALID_REQUEST', `Champ interdit : ${forbidden}`);
    const mergedMap = new Map(request.fields.map((field) => [field.name, field]));
    for (const field of fields) {
      mergedMap.set(field.name, { name: field.name, label: fieldLabel(procedure, field.name), value: field.value, source: field.source });
    }
    const merged = [...mergedMap.values()];
    const values = Object.fromEntries(merged.map((field) => [field.name, field.value]));
    if (!this.forms.for(procedure).partial(values)) throw new ProblemError(400, 'INVALID_REQUEST', 'Champ inconnu ou invalide pour cette démarche');
    return this.save(request, { ...request, fields: merged, status: this.statusOf(procedure, merged, request.documents) }, call, procedure);
  }

  private async attach(requestId: string, fileId: string, documentType: string, call: ToolInvocation<Loaded & { file: FileMetadata }>) {
    const { procedure, file } = call.prepared;
    const request = await this.editable(requestId, call);
    const spec = filingOf(procedure).requiredDocuments.find((document) => document.documentType === documentType);
    if (!spec) throw new ProblemError(400, 'INVALID_REQUEST', 'Type de pièce inconnu pour cette démarche');
    const problem = this.fileProblems(file)[0];
    if (problem) throw new ProblemError(400, 'INVALID_REQUEST', problem);
    const documents = [...request.documents.filter((document) => document.documentType !== documentType), { documentType, label: spec.label, fileId }];
    const next = { ...request, documents };
    return this.save(request, { ...next, status: this.statusOf(procedure, request.fields, next.documents) }, call, procedure);
  }

  private async submit(requestId: string, call: ToolInvocation<Loaded & { files: Map<string, FileMetadata> }>) {
    const { procedure, files } = call.prepared;
    const request = await this.editable(requestId, call);
    const missing = this.missingOf(procedure, request.fields, request.documents);
    if (missing.length) throw new ProblemError(409, 'REQUEST_INCOMPLETE', 'Champs ou pièces manquants');
    const channel = call.context.channel;
    if (channel !== 'web' && channel !== 'whatsapp') throw new ProblemError(400, 'INVALID_REQUEST', 'X-Channel web ou whatsapp requis pour le dépôt');
    for (const document of request.documents) {
      if (!document.fileId) continue;
      const file = files.get(document.fileId);
      if (!file) throw new ProblemError(409, 'INVALID_TRANSITION', 'Demande modifiée pendant la préparation ; réessayer');
      if (this.fileProblems(file).length) throw new ProblemError(409, 'REQUEST_INCOMPLETE', `Pièce ${document.documentType} à remplacer`);
    }
    const documents: { documentType: string; uploadId: string }[] = [];
    for (const document of request.documents) {
      if (!document.fileId) continue;
      const file = files.get(document.fileId);
      if (!file) throw new ProblemError(409, 'INVALID_TRANSITION', 'Demande modifiée pendant la préparation ; réessayer');
      const bytes = await this.resources.getFileContent(document.fileId, call.context.userRef, call.trace);
      documents.push({
        documentType: document.documentType,
        uploadId: await this.xroad.upload(call.context.userRef, bytes, file.mimeType, call.trace, `upload-${request.id}-${document.documentType}`),
      });
    }
    const created = await this.xroad.createCase(
      call.context.userRef,
      {
        requestId: request.id,
        procedureId: request.procedureId,
        channel,
        fields: Object.fromEntries(request.fields.map((field) => [field.name, field.value])),
        documents,
      },
      call.trace,
    );
    const saved = await this.requests.update(call.tx, { ...request, status: 'submitted', caseId: created.id, missing: [] });
    await this.requests.recordExternal(call.tx, saved.id, created);
    call.emit({ kind: 'case.updated', conversationId: saved.conversationId, case: created });
    return { request: toContract(saved), case: created };
  }

  private async pay(requestId: string, call: PreparationContext): Promise<{ request: RequestRecord; paid: XroadCase }> {
    const { request, submission } = await call.read(async (tx) => {
      const request = await this.requests.findOwned(tx, requestId, call.context);
      await this.mandates.requireForTool(tx, call.context, tools.get('request.pay')!.definition._meta['bj.techma/scopes'], request.procedureId);
      return { request, submission: await this.requests.submission(tx, requestId) };
    });
    const caseId = request.caseId ?? submission.externalRef;
    if (!caseId) throw new ProblemError(409, 'INVALID_TRANSITION', "Dossier non transmis à l'administration");
    const found = await this.xroad.getCase(call.context.userRef, caseId, requestId, call.trace);
    const paid = found.payment.status === 'pending' ? await this.xroad.pay(call.context.userRef, caseId, requestId, call.trace) : found;
    return { request, paid };
  }

  private verify(fileId: string, file: FileMetadata) {
    const reasons = this.fileProblems(file);
    return { fileId, status: reasons.length ? 'invalid' : 'valid', reasons };
  }

  private async editable(requestId: string, call: ToolInvocation<Loaded>): Promise<RequestRecord> {
    const request = await this.requests.findOwned(call.tx, requestId, call.context, true);
    await call.requireMandate(request.procedureId);
    if (!EDITABLE.has(request.status)) throw new ProblemError(409, 'INVALID_TRANSITION', 'Demande non modifiable dans cet état');
    if (request.procedureId !== call.prepared.procedure.id) throw new ProblemError(409, 'INVALID_TRANSITION', 'Demande modifiée pendant la préparation ; réessayer');
    return request;
  }

  private statusOf(procedure: Procedure, fields: RequestField[], documents: RequestRecord['documents']): RequestStatus {
    return this.missingOf(procedure, fields, documents).length ? 'draft' : 'ready';
  }

  private missingOf(procedure: Procedure, fields: RequestField[], documents: RequestRecord['documents']): string[] {
    const values = Object.fromEntries(fields.map((field) => [field.name, field.value]));
    const missing: string[] = [];
    if (!this.forms.for(procedure).complete(values)) {
      const required = ((filingOf(procedure).formSchema as { required?: string[] }).required ?? []).filter((name) => values[name] === undefined || values[name] === null || values[name] === '');
      missing.push(...(required.length ? required : ['formulaire']));
    }
    for (const document of filingOf(procedure).requiredDocuments) {
      if (!documents.some((item) => item.documentType === document.documentType && item.fileId)) missing.push(document.label);
    }
    return missing;
  }

  private withMissing(request: RequestRecord, procedure: Procedure): RequestRecord {
    return { ...request, missing: this.missingOf(procedure, request.fields, request.documents) };
  }

  private fileProblems(file: FileMetadata): string[] {
    const problems: string[] = [];
    if (Date.parse(file.expiresAt) <= Date.now()) problems.push('Pièce expirée');
    return problems;
  }

  private async save(before: RequestRecord, next: RequestRecord, call: ToolInvocation<unknown>, procedure: Procedure) {
    const prepared = this.withMissing(next, procedure);
    const saved = await this.requests.update(call.tx, prepared);
    return toContract(saved);
  }
}

@Module({
  imports: [ProceduresModule, ResourcesModule],
  providers: [RequestsRepository, FormSchemas, RequestTools],
})
export class RequestsModule {}
