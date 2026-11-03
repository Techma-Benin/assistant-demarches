import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { BackendClient, type FileMetadata } from '../backend/backend.client.js';
import { sha256, newId } from '../common/ids.js';
import { ProblemError } from '../common/problem.js';
import { compileSchema, errorsText, tools } from '../contracts.js';
import { ToolRegistry, type PreparationContext, type ToolHandler, type ToolInvocation } from '../gateway/tool-registry.js';
import { MandatesRepository } from '../mandates/mandates.repository.js';
import { XroadClient, type DocumentRef, type FieldValue, type Filing, type Procedure, type XroadCase } from '../xroad/xroad.client.js';
import { RequestsRepository, draftOf, fieldValues, statusOf, toContract, type RequestRecord } from './requests.repository.js';

const EDITABLE = new Set(['draft', 'ready']);
const caseState = (found: XroadCase) => `${found.status}|${found.updatedAt}`;

interface FieldInput {
  name: string;
  value: FieldValue;
  source: 'answer' | 'document';
}

interface FileInput {
  documentType: string;
  fileId: string;
}

@Injectable()
class RequestTools implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly xroad: XroadClient,
    private readonly backend: BackendClient,
    private readonly requests: RequestsRepository,
    private readonly mandates: MandatesRepository,
  ) {}

  onModuleInit(): void {
    const create: ToolHandler<Procedure & { filing: Filing }> = {
      name: 'request.create',
      prepare: async (args, call) => {
        const procedure = await this.xroad.getProcedure(args.procedureId as string, call.trace);
        if (!procedure.filing) throw new ProblemError(409, 'NOT_ASSISTED', `Dépôt par l'assistant non disponible pour cette démarche : voir la fiche officielle`);
        return procedure as Procedure & { filing: Filing };
      },
      run: async (_args, call) => {
        const procedure = call.prepared;
        await call.requireMandate(procedure.id);
        const draft = draftOf(procedure);
        const request = await this.requests.insert(call.tx, {
          id: newId('req'),
          conversationId: call.context.conversationId,
          userRef: call.context.userRef,
          procedureId: procedure.id,
          title: procedure.title.slice(0, 300),
          administrationId: procedure.administrationId,
          status: statusOf(draft),
          ...draft,
        });
        return toContract(request);
      },
    };

    const update: ToolHandler = {
      name: 'request.update',
      run: async (args, call) => {
        const request = await this.editable(args.requestId as string, call);
        const known = new Map(request.fields.map((field) => [field.name, field]));
        const changes = args.fields as FieldInput[];
        for (const change of changes) if (!known.has(change.name)) throw new ProblemError(400, 'INVALID_REQUEST', `Champ inconnu pour cette démarche : ${change.name}`);
        const fields = request.fields.map((field) => {
          const change = [...changes].reverse().find((candidate) => candidate.name === field.name);
          return change ? { ...field, value: change.value, source: change.value === null ? null : change.source } : field;
        });
        const partial = compileSchema({ ...request.filing.formSchema, required: [] });
        if (!partial(fieldValues({ fields }))) throw new ProblemError(400, 'INVALID_REQUEST', `Valeur invalide : ${errorsText(partial)}`);
        const next = { ...request, fields };
        return toContract(await this.requests.saveDraft(call.tx, { ...next, status: statusOf(next) }));
      },
    };

    const attach: ToolHandler<FileMetadata> = {
      name: 'documents.attach',
      prepare: (args, call) => this.backend.getFile(args.fileId as string, call.context.userRef, call.trace),
      run: async (args, call) => {
        const request = await this.editable(args.requestId as string, call);
        const required = request.filing.requiredDocuments.find((document) => document.documentType === args.documentType);
        if (!required) throw new ProblemError(400, 'INVALID_REQUEST', 'Type de pièce inconnu pour cette démarche');
        this.checkFile(call.prepared, required.acceptedMimeTypes, required.label);
        const documents = request.documents.map((document) => (document.documentType === required.documentType ? { ...document, fileId: call.prepared.id } : document));
        const next = { ...request, documents };
        return toContract(await this.requests.saveDraft(call.tx, { ...next, status: statusOf(next) }));
      },
    };

    const submit: ToolHandler<XroadCase> = {
      name: 'request.submit',
      prepare: async (args, call) => {
        if (!call.context.channel) throw new ProblemError(400, 'INVALID_REQUEST', 'X-Channel requis pour déposer un dossier');
        const request = await this.prepared(args.requestId as string, call, 'request.submit');
        if (request.status === 'submitted') throw new ProblemError(409, 'INVALID_TRANSITION', 'Demande déjà déposée');
        if (request.status !== 'ready' || statusOf(request) !== 'ready') throw new ProblemError(409, 'REQUEST_INCOMPLETE', 'Champs ou pièces manquants');
        const documents = await this.transmit(
          request,
          request.documents.map((document) => ({ documentType: document.documentType, fileId: document.fileId as string })),
          call,
        );
        return this.xroad.createCase(
          call.context.userRef,
          { requestId: request.id, procedureId: request.procedureId, channel: call.context.channel, fields: fieldValues(request), documents },
          call.trace,
        );
      },
      run: async (args, call) => {
        const request = await this.requests.findOwned(call.tx, args.requestId as string, call.context, true);
        await call.requireMandate(request.procedureId);
        if (request.status !== 'ready') throw new ProblemError(409, 'INVALID_TRANSITION', 'Demande modifiée pendant le dépôt ; réessayer');
        const filed = call.prepared;
        const submitted = await this.requests.markSubmitted(call.tx, request.id, filed.id, call.context.channel as string, caseState(filed));
        return { request: toContract(submitted), case: filed };
      },
    };

    const pay: ToolHandler<XroadCase> = {
      name: 'request.pay',
      prepare: async (args, call) => {
        const request = await this.prepared(args.requestId as string, call, 'request.pay');
        const caseId = this.caseOf(request);
        const found = await this.xroad.getCase(call.context.userRef, caseId, request.id, call.trace);
        if (found.status === 'awaiting_payment') return this.xroad.pay(call.context.userRef, caseId, request.id, call.trace);
        if (found.payment.status === 'paid') return found;
        throw new ProblemError(409, 'INVALID_TRANSITION', 'Aucun paiement attendu pour ce dossier');
      },
      run: (args, call) => this.recordCase(args.requestId as string, call),
    };

    const status: ToolHandler<XroadCase> = {
      name: 'case.status',
      prepare: async (args, call) => {
        const request = await call.read((tx) => this.requests.findOwned(tx, args.requestId as string, call.context));
        return this.xroad.getCase(call.context.userRef, this.caseOf(request), request.id, call.trace);
      },
      run: async (_args, call) => call.prepared,
    };

    const respond: ToolHandler<XroadCase> = {
      name: 'case.respond',
      prepare: async (args, call) => {
        const request = await this.prepared(args.requestId as string, call, 'case.respond');
        const caseId = this.caseOf(request);
        const files = args.fileIds as FileInput[];
        for (const file of files) {
          if (!request.filing.requiredDocuments.some((document) => document.documentType === file.documentType)) {
            throw new ProblemError(400, 'INVALID_REQUEST', `Type de pièce inconnu pour cette démarche : ${file.documentType}`);
          }
        }
        const documents = await this.transmit(request, files, call);
        const key = `respond-${request.id}-${sha256(call.idempotencyKey ?? '').slice(0, 32)}`;
        return this.xroad.respond(
          call.context.userRef,
          caseId,
          request.id,
          { message: args.message as string, fields: args.fields as Record<string, FieldValue>, documents },
          key,
          call.trace,
        );
      },
      run: (args, call) => this.recordCase(args.requestId as string, call),
    };

    this.registry.register(create, update, attach, submit, pay, status, respond);
  }

  private async editable(requestId: string, call: ToolInvocation<unknown>): Promise<RequestRecord> {
    const request = await this.requests.findOwned(call.tx, requestId, call.context, true);
    await call.requireMandate(request.procedureId);
    if (!EDITABLE.has(request.status)) throw new ProblemError(409, 'INVALID_TRANSITION', 'Demande non modifiable dans cet état');
    return request;
  }

  private async prepared(requestId: string, call: PreparationContext, toolName: string): Promise<RequestRecord> {
    return call.read(async (tx) => {
      const request = await this.requests.findOwned(tx, requestId, call.context);
      await this.mandates.requireForTool(tx, call.context, tools.get(toolName)!.definition._meta['bj.techma/scopes'], request.procedureId);
      return request;
    });
  }

  private caseOf(request: RequestRecord): string {
    if (request.status !== 'submitted' || !request.caseId) throw new ProblemError(409, 'INVALID_TRANSITION', "Demande pas encore déposée auprès de l'administration");
    return request.caseId;
  }

  private async recordCase(requestId: string, call: ToolInvocation<XroadCase>): Promise<XroadCase> {
    const request = await this.requests.findOwned(call.tx, requestId, call.context, true);
    await call.requireMandate(request.procedureId);
    await this.requests.recordCaseState(call.tx, request.id, caseState(call.prepared));
    return call.prepared;
  }

  private async transmit(request: RequestRecord, files: FileInput[], call: PreparationContext): Promise<DocumentRef[]> {
    const documents: DocumentRef[] = [];
    for (const { documentType, fileId } of files) {
      const required = request.filing.requiredDocuments.find((document) => document.documentType === documentType);
      const file = await this.backend.getFile(fileId, call.context.userRef, call.trace);
      this.checkFile(file, required?.acceptedMimeTypes ?? [], required?.label ?? documentType);
      const bytes = await this.backend.fileContent(fileId, call.context.userRef, call.trace);
      const uploaded = await this.xroad.upload(call.context.userRef, bytes, file.mimeType, call.trace);
      documents.push({ documentType, uploadId: uploaded.id });
    }
    return documents;
  }

  private checkFile(file: FileMetadata, accepted: string[], label: string): void {
    if (Date.parse(file.expiresAt) <= Date.now()) throw new ProblemError(409, 'REQUEST_INCOMPLETE', `Pièce expirée : ${label}`);
    if (!accepted.includes(file.mimeType)) throw new ProblemError(415, 'UNSUPPORTED_MEDIA_TYPE', `Format non accepté pour ${label}`);
  }
}

@Module({ providers: [RequestsRepository, RequestTools] })
export class RequestsModule {}
