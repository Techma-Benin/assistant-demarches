import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { newId } from '../common/ids.js';
import { ProblemError } from '../common/problem.js';
import { inTransaction, settle, ToolRegistry, unwrap, type Settled, type ToolHandler, type ToolInvocation, type ToolPreparation } from '../gateway/tool-registry.js';
import { ProcedureCatalog, ProceduresModule } from '../procedures/procedures.module.js';
import { BackendResourcesClient, type FileMetadata, type Procedure } from '../resources/backend-resources.client.js';
import { ResourcesModule } from '../resources/resources.module.js';
import { FormSchemas } from './form-schemas.js';
import { RequestsRepository, toContract, type Fields, type RequestRecord, type RequestStatus } from './requests.repository.js';

const EDITABLE: ReadonlySet<RequestStatus> = new Set(['draft', 'ready']);

interface Prepared {
  procedure: Settled<Procedure>;
  files: Map<string, Settled<FileMetadata>>;
}

type FileSelection = string[] | 'attached';

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
    const tool = (name: string, run: ToolHandler['run'], prepare?: ToolHandler['prepare']): ToolHandler => ({ name, run, prepare });
    this.registry.register(
      tool('request.create', (args, call) => this.create(args.procedureId as string, call), (args, call) => this.prepareProcedure(args.procedureId as string, call)),
      tool('request.update', (args, call) => this.update(args.requestId as string, args.fields as Fields, call), (args, call) => this.prepareRequest(args.requestId as string, [], call)),
      tool('request.submit', (args, call) => this.submit(args.requestId as string, call), (args, call) => this.prepareRequest(args.requestId as string, 'attached', call)),
      tool('request.status', async (args, call) => toContract(await this.requests.findOwned(call.tx, args.requestId as string, call.context))),
      tool(
        'documents.attach',
        (args, call) => this.attach(args.requestId as string, args.fileId as string, args.documentType as string, call),
        (args, call) => this.prepareRequest(args.requestId as string, [args.fileId as string], call),
      ),
      tool('documents.verify', (args, call) => this.verify(args.requestId as string, args.fileId as string, call), (args, call) => this.prepareVerify(args.requestId as string, args.fileId as string, call)),
    );
  }

  private async prepareProcedure(procedureId: string, call: ToolPreparation): Promise<Prepared> {
    return { procedure: await settle(this.catalog.get(procedureId, call.trace)), files: new Map() };
  }

  private async prepareRequest(requestId: string, selection: FileSelection, call: ToolPreparation): Promise<Prepared> {
    const request = await call.read((tx) => this.requests.findOwned(tx, requestId, call.context));
    const fileIds = selection === 'attached' ? request.documents.map((document) => document.fileId) : selection;
    const procedure = settle(this.catalog.get(request.procedureId, call.trace));
    const files = await Promise.all(fileIds.map(async (fileId) => [fileId, await settle(this.resources.getFile(fileId, call.context.userRef, call.trace))] as const));
    return { procedure: await procedure, files: new Map(files) };
  }

  private async prepareVerify(requestId: string, fileId: string, call: ToolPreparation): Promise<Settled<FileMetadata>> {
    const request = await call.read((tx) => this.requests.findOwned(tx, requestId, call.context));
    if (!request.documents.some((document) => document.fileId === fileId)) throw new ProblemError(404, 'NOT_FOUND', 'Pièce non attachée à cette demande');
    return settle(this.resources.getFile(fileId, call.context.userRef, call.trace));
  }

  private async create(procedureId: string, call: ToolInvocation) {
    const prepared = (call.prepared as Prepared | undefined) ?? (await this.prepareProcedure(procedureId, inTransaction(call)));
    const procedure = unwrap(prepared.procedure);
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

  private async update(requestId: string, fields: Fields, call: ToolInvocation) {
    const { request, procedure } = await this.editable(requestId, [], call);
    const forbidden = this.forms.forbiddenField(fields);
    if (forbidden) throw new ProblemError(400, 'INVALID_REQUEST', `Champ interdit : ${forbidden}`);
    const merged = { ...request.fields, ...fields };
    const form = this.forms.for(procedure);
    if (!form.partial(merged)) throw new ProblemError(400, 'INVALID_REQUEST', 'Champ inconnu ou invalide pour cette démarche');
    return this.save(request, { ...request, fields: merged, status: this.statusOf(procedure, merged, request) }, call);
  }

  private async attach(requestId: string, fileId: string, documentType: string, call: ToolInvocation) {
    const { request, procedure, files } = await this.editable(requestId, [fileId], call);
    if (!procedure.requiredDocuments.includes(documentType)) throw new ProblemError(400, 'INVALID_REQUEST', 'Type de pièce inconnu pour cette démarche');
    const file = unwrap(files.get(fileId) ?? (await settle(this.resources.getFile(fileId, call.context.userRef, call.trace))));
    const problem = this.fileProblems(file)[0];
    if (problem) throw new ProblemError(400, 'INVALID_REQUEST', problem);
    const documents = [...request.documents.filter((document) => document.documentType !== documentType), { documentType, fileId }];
    const next = { ...request, documents };
    return this.save(request, { ...next, status: this.statusOf(procedure, request.fields, next) }, call);
  }

  private async submit(requestId: string, call: ToolInvocation) {
    const { request, procedure, files } = await this.editable(requestId, 'attached', call);
    if (this.statusOf(procedure, request.fields, request) !== 'ready') throw new ProblemError(409, 'REQUEST_INCOMPLETE', 'Champs ou pièces manquants');
    for (const document of request.documents) {
      const checked = files.get(document.fileId);
      if (!checked) throw new ProblemError(409, 'INVALID_TRANSITION', 'Demande modifiée pendant la vérification ; réessayer');
      if (this.fileProblems(unwrap(checked)).length) throw new ProblemError(409, 'REQUEST_INCOMPLETE', `Pièce ${document.documentType} à remplacer`);
    }
    return this.save(request, { ...request, status: 'awaiting_user_validation', officialLink: procedure.source.url }, call);
  }

  private async verify(requestId: string, fileId: string, call: ToolInvocation) {
    const file = unwrap((call.prepared as Settled<FileMetadata> | undefined) ?? (await this.prepareVerify(requestId, fileId, inTransaction(call))));
    if (file.scanStatus === 'pending') return { fileId, status: 'pending', reasons: ['Analyse antivirus en cours'] };
    const reasons = this.fileProblems(file);
    return { fileId, status: reasons.length ? 'invalid' : 'valid', reasons };
  }

  private async editable(requestId: string, selection: FileSelection, call: ToolInvocation): Promise<{ request: RequestRecord; procedure: Procedure; files: Prepared['files'] }> {
    const prepared = (call.prepared as Prepared | undefined) ?? (await this.prepareRequest(requestId, selection, inTransaction(call)));
    const request = await this.requests.findOwned(call.tx, requestId, call.context, true);
    await call.requireMandate(request.procedureId);
    if (!EDITABLE.has(request.status)) throw new ProblemError(409, 'INVALID_TRANSITION', 'Demande non modifiable dans cet état');
    return { request, procedure: unwrap(prepared.procedure), files: prepared.files };
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

  private async save(before: RequestRecord, next: RequestRecord, call: ToolInvocation) {
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
