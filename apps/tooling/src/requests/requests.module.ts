import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { newId } from '../common/ids.js';
import { ProblemError } from '../common/problem.js';
import { ToolRegistry, type PreparationContext, type ToolHandler, type ToolInvocation } from '../gateway/tool-registry.js';
import { ProcedureCatalog, ProceduresModule } from '../procedures/procedures.module.js';
import { BackendResourcesClient, type FileMetadata, type Procedure } from '../resources/backend-resources.client.js';
import { ResourcesModule } from '../resources/resources.module.js';
import { FormSchemas } from './form-schemas.js';
import { RequestsRepository, toContract, type Fields, type RequestRecord, type RequestStatus } from './requests.repository.js';

const EDITABLE: ReadonlySet<RequestStatus> = new Set(['draft', 'ready']);

interface Loaded {
  request: RequestRecord;
  procedure: Procedure;
}

@Injectable()
class RequestTools implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly catalog: ProcedureCatalog,
    private readonly resources: BackendResourcesClient,
    private readonly requests: RequestsRepository,
    private readonly forms: FormSchemas,
  ) {}

  onModuleInit(): void {
    const create: ToolHandler<Procedure> = {
      name: 'request.create',
      prepare: (args, call) => this.catalog.get(args.procedureId as string, call.trace),
      run: (_args, call) => this.create(call),
    };
    const update: ToolHandler<Loaded> = {
      name: 'request.update',
      prepare: (args, call) => this.load(args.requestId as string, call),
      run: (args, call) => this.update(args.requestId as string, args.fields as Fields, call),
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
        for (const { fileId } of loaded.request.documents) files.set(fileId, await this.resources.getFile(fileId, call.context.userRef, call.trace));
        return { ...loaded, files };
      },
      run: (args, call) => this.submit(args.requestId as string, call),
    };
    const verify: ToolHandler<{ fileId: string; file: FileMetadata }> = {
      name: 'documents.verify',
      prepare: async (args, call) => {
        const request = await call.read((tx) => this.requests.findOwned(tx, args.requestId as string, call.context));
        if (!request.documents.some((document) => document.fileId === args.fileId)) throw new ProblemError(404, 'NOT_FOUND', 'Pièce non attachée à cette demande');
        return { fileId: args.fileId as string, file: await this.resources.getFile(args.fileId as string, call.context.userRef, call.trace) };
      },
      run: async (_args, call) => this.verify(call.prepared.fileId, call.prepared.file),
    };
    const status: ToolHandler = {
      name: 'request.status',
      run: async (args, call) => toContract(await this.requests.findOwned(call.tx, args.requestId as string, call.context)),
    };
    this.registry.register(create, update, attach, submit, verify, status);
  }

  private async load(requestId: string, call: PreparationContext): Promise<Loaded> {
    const request = await call.read((tx) => this.requests.findOwned(tx, requestId, call.context));
    return { request, procedure: await this.catalog.get(request.procedureId, call.trace) };
  }

  private async create(call: ToolInvocation<Procedure>) {
    const procedure = call.prepared;
    await call.requireMandate(procedure.id);
    const request = await this.requests.insert(call.tx, {
      id: newId('req'),
      conversationId: call.context.conversationId,
      userRef: call.context.userRef,
      procedureId: procedure.id,
      status: 'draft',
      fields: {},
      documents: [],
      officialLink: null,
    });
    const output = toContract(request);
    call.emit({ kind: 'request.created', request: output });
    return output;
  }

  private async update(requestId: string, fields: Fields, call: ToolInvocation<Loaded>) {
    const { procedure } = call.prepared;
    const request = await this.editable(requestId, call);
    const forbidden = this.forms.forbiddenField(fields);
    if (forbidden) throw new ProblemError(400, 'INVALID_REQUEST', `Champ interdit : ${forbidden}`);
    const merged = { ...request.fields, ...fields };
    const form = this.forms.for(procedure);
    if (!form.partial(merged)) throw new ProblemError(400, 'INVALID_REQUEST', 'Champ inconnu ou invalide pour cette démarche');
    return this.save(request, { ...request, fields: merged, status: this.statusOf(procedure, merged, request) }, call);
  }

  private async attach(requestId: string, fileId: string, documentType: string, call: ToolInvocation<Loaded & { file: FileMetadata }>) {
    const { procedure, file } = call.prepared;
    const request = await this.editable(requestId, call);
    if (!procedure.requiredDocuments.includes(documentType)) throw new ProblemError(400, 'INVALID_REQUEST', 'Type de pièce inconnu pour cette démarche');
    const problem = this.fileProblems(file)[0];
    if (problem) throw new ProblemError(400, 'INVALID_REQUEST', problem);
    const documents = [...request.documents.filter((document) => document.documentType !== documentType), { documentType, fileId }];
    const next = { ...request, documents };
    return this.save(request, { ...next, status: this.statusOf(procedure, request.fields, next) }, call);
  }

  private async submit(requestId: string, call: ToolInvocation<Loaded & { files: Map<string, FileMetadata> }>) {
    const { procedure, files } = call.prepared;
    const request = await this.editable(requestId, call);
    if (this.statusOf(procedure, request.fields, request) !== 'ready') throw new ProblemError(409, 'REQUEST_INCOMPLETE', 'Champs ou pièces manquants');
    for (const document of request.documents) {
      const file = files.get(document.fileId);
      if (!file) throw new ProblemError(409, 'INVALID_TRANSITION', 'Demande modifiée pendant la préparation ; réessayer');
      if (this.fileProblems(file).length) throw new ProblemError(409, 'REQUEST_INCOMPLETE', `Pièce ${document.documentType} à remplacer`);
    }
    return this.save(request, { ...request, status: 'awaiting_user_validation', officialLink: procedure.source.url }, call);
  }

  private verify(fileId: string, file: FileMetadata) {
    if (file.scanStatus === 'pending') return { fileId, status: 'pending', reasons: ['Analyse antivirus en cours'] };
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

  private statusOf(procedure: Procedure, fields: Fields, request: Pick<RequestRecord, 'documents'>): RequestStatus {
    const documentsPresent = procedure.requiredDocuments.every((type) => request.documents.some((document) => document.documentType === type));
    return documentsPresent && this.forms.for(procedure).complete(fields) ? 'ready' : 'draft';
  }

  private fileProblems(file: FileMetadata): string[] {
    const problems: string[] = [];
    if (file.scanStatus === 'pending') problems.push('Pièce en cours d\'analyse');
    if (file.scanStatus === 'rejected') problems.push('Pièce rejetée par l\'analyse');
    if (Date.parse(file.expiresAt) <= Date.now()) problems.push('Pièce expirée');
    return problems;
  }

  private async save(before: RequestRecord, next: RequestRecord, call: ToolInvocation<unknown>) {
    const saved = await this.requests.update(call.tx, next);
    if (saved.status !== before.status) {
      call.emit({ kind: 'request.status_changed', requestId: saved.id, conversationId: saved.conversationId, from: before.status, to: saved.status, at: saved.updatedAt });
    }
    return toContract(saved);
  }
}

@Module({
  imports: [ProceduresModule, ResourcesModule],
  providers: [RequestsRepository, FormSchemas, RequestTools],
})
export class RequestsModule {}
