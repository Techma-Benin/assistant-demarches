import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { newId } from '../common/ids.js';
import { ProblemError } from '../common/problem.js';
import { ToolRegistry, type ToolHandler, type ToolInvocation } from '../gateway/tool-registry.js';
import { ProcedureCatalog, ProceduresModule } from '../procedures/procedures.module.js';
import { BackendResourcesClient, type FileMetadata, type Procedure } from '../resources/backend-resources.client.js';
import { ResourcesModule } from '../resources/resources.module.js';
import { FormSchemas } from './form-schemas.js';
import { RequestsRepository, toContract, type Fields, type RequestRecord, type RequestStatus } from './requests.repository.js';

const EDITABLE: ReadonlySet<RequestStatus> = new Set(['draft', 'ready']);

/**
 * Machine d'état v1 : draft → ready (champs et pièces requis présents) → awaiting_user_validation.
 * Les états submitted et suivants sont réservés aux connecteurs réels : jamais produits ici.
 */
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
    const tool = (name: string, run: ToolHandler['run']): ToolHandler => ({ name, run });
    this.registry.register(
      tool('request.create', (args, call) => this.create(args.procedureId as string, call)),
      tool('request.update', (args, call) => this.update(args.requestId as string, args.fields as Fields, call)),
      tool('request.submit', (args, call) => this.submit(args.requestId as string, call)),
      tool('request.status', async (args, call) => toContract(await this.requests.findOwned(call.tx, args.requestId as string, call.context))),
      tool('documents.attach', (args, call) => this.attach(args.requestId as string, args.fileId as string, args.documentType as string, call)),
      tool('documents.verify', (args, call) => this.verify(args.requestId as string, args.fileId as string, call)),
    );
  }

  private async create(procedureId: string, call: ToolInvocation) {
    const procedure = await this.catalog.get(procedureId, call.trace);
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
    const { request, procedure } = await this.editable(requestId, call);
    const forbidden = this.forms.forbiddenField(fields);
    if (forbidden) throw new ProblemError(400, 'INVALID_REQUEST', `Champ interdit : ${forbidden}`);
    const merged = { ...request.fields, ...fields };
    const form = this.forms.for(procedure);
    if (!form.partial(merged)) throw new ProblemError(400, 'INVALID_REQUEST', 'Champ inconnu ou invalide pour cette démarche');
    return this.save(request, { ...request, fields: merged, status: this.statusOf(procedure, merged, request) }, call);
  }

  private async attach(requestId: string, fileId: string, documentType: string, call: ToolInvocation) {
    const { request, procedure } = await this.editable(requestId, call);
    if (!procedure.requiredDocuments.includes(documentType)) throw new ProblemError(400, 'INVALID_REQUEST', 'Type de pièce inconnu pour cette démarche');
    const file = await this.resources.getFile(fileId, call.context.userRef, call.trace);
    const problem = this.fileProblems(file)[0];
    if (problem) throw new ProblemError(400, 'INVALID_REQUEST', problem);
    const documents = [...request.documents.filter((document) => document.documentType !== documentType), { documentType, fileId }];
    const next = { ...request, documents };
    return this.save(request, { ...next, status: this.statusOf(procedure, request.fields, next) }, call);
  }

  private async submit(requestId: string, call: ToolInvocation) {
    const { request, procedure } = await this.editable(requestId, call);
    if (this.statusOf(procedure, request.fields, request) !== 'ready') throw new ProblemError(409, 'REQUEST_INCOMPLETE', 'Champs ou pièces manquants');
    // Les pièces sont revérifiées au moment de la préparation finale : scan et péremption.
    for (const document of request.documents) {
      const file = await this.resources.getFile(document.fileId, call.context.userRef, call.trace);
      if (this.fileProblems(file).length) throw new ProblemError(409, 'REQUEST_INCOMPLETE', `Pièce ${document.documentType} à remplacer`);
    }
    // v1 : préparation seulement. L'usager termine sur le portail officiel de la fiche.
    return this.save(request, { ...request, status: 'awaiting_user_validation', officialLink: procedure.source.url }, call);
  }

  private async verify(requestId: string, fileId: string, call: ToolInvocation) {
    const request = await this.requests.findOwned(call.tx, requestId, call.context);
    if (!request.documents.some((document) => document.fileId === fileId)) throw new ProblemError(404, 'NOT_FOUND', 'Pièce non attachée à cette demande');
    const file = await this.resources.getFile(fileId, call.context.userRef, call.trace);
    // Vérification technique seulement : aucune certification administrative.
    if (file.scanStatus === 'pending') return { fileId, status: 'pending', reasons: ['Analyse antivirus en cours'] };
    const reasons = this.fileProblems(file);
    return { fileId, status: reasons.length ? 'invalid' : 'valid', reasons };
  }

  private async editable(requestId: string, call: ToolInvocation): Promise<{ request: RequestRecord; procedure: Procedure }> {
    const request = await this.requests.findOwned(call.tx, requestId, call.context, true);
    await call.requireMandate(request.procedureId);
    if (!EDITABLE.has(request.status)) throw new ProblemError(409, 'INVALID_TRANSITION', 'Demande non modifiable dans cet état');
    return { request, procedure: await this.catalog.get(request.procedureId, call.trace) };
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
