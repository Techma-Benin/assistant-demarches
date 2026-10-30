import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ProblemError } from '../common/problem.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import type { FileMetadata, Procedure } from '../resources/backend-resources.client.js';
import { XroadClient, type CaseStatus, type XroadCase } from '../xroad/xroad.client.js';

export interface SubmissionInput {
  requestId: string;
  userRef: string;
  procedure: Procedure;
  fields: Record<string, string | number | boolean | null>;
  documents: { documentType: string; file: FileMetadata }[];
  traceId: string;
}

export interface Receipt {
  reference: string;
  receivedAt: string;
}

export type ExternalStage = 'filed' | 'processing' | 'in_review' | 'completed' | 'rejected';

export interface ExternalDocument {
  id: string;
  name: string;
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg';
  issuedAt: string;
}

export interface ExternalCase {
  stage: ExternalStage;
  blocker?: { detail: string; at: string };
  payment?: { status: 'not_required' | 'pending' | 'paid'; amountFcfa: number; reference: string | null };
  completedBy?: 'ai' | 'human';
  completedAt?: string;
  documents: ExternalDocument[];
}

export type SubmissionResult =
  | { kind: 'submitted'; externalRef: string; receipt: Receipt; state: ExternalCase }
  | { kind: 'user_action_required'; link: string };

export interface TrackingContext {
  requestId: string;
  userRef: string;
  traceId: string;
}

export interface DecisionInput {
  decision: 'approve' | 'reject';
  note: string | null;
  actorRef: string;
  idempotencyKey: string;
}

export interface AdministrationConnector {
  readonly id: string;
  supports(procedure: Procedure): boolean;
  submit(input: SubmissionInput): Promise<SubmissionResult>;
  status(externalRef: string, context: TrackingContext): Promise<ExternalCase>;
  decide?(externalRef: string, input: DecisionInput, context: TrackingContext): Promise<ExternalCase>;
  document?(externalRef: string, documentId: string, context: TrackingContext): Promise<Buffer>;
}

@Injectable()
export class ConnectorRegistry {
  private readonly connectors = new Map<string, AdministrationConnector>();

  constructor(@Inject(TOOLING_CONFIG) private readonly config: ToolingConfig) {}

  register(connector: AdministrationConnector): void {
    if (this.connectors.has(connector.id)) throw new Error(`Connecteur inscrit deux fois : ${connector.id}`);
    this.connectors.set(connector.id, connector);
  }

  forProcedure(procedure: Procedure): AdministrationConnector | undefined {
    for (const id of this.config.connectors.enabled) {
      const connector = this.connectors.get(id);
      if (connector?.supports(procedure)) return connector;
    }
    return undefined;
  }

  get(id: string): AdministrationConnector | undefined {
    return this.config.connectors.enabled.includes(id) ? this.connectors.get(id) : undefined;
  }
}

@Injectable()
export class SimulatedConnector implements AdministrationConnector, OnModuleInit {
  readonly id = 'simulated';

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    private readonly registry: ConnectorRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  supports(): boolean {
    return true;
  }

  async submit(input: SubmissionInput): Promise<SubmissionResult> {
    const receivedAt = new Date();
    const externalRef = `SIMULATION-${input.requestId}-${receivedAt.getTime()}`;
    return { kind: 'submitted', externalRef, receipt: { reference: externalRef, receivedAt: receivedAt.toISOString() }, state: { stage: 'filed', documents: [] } };
  }

  async status(externalRef: string): Promise<ExternalCase> {
    const sentAt = Number(/-(\d+)$/.exec(externalRef)?.[1]);
    if (!Number.isFinite(sentAt)) throw new Error('Référence simulée illisible');
    const since = Date.now() - sentAt;
    const step = this.config.connectors.simulatedStepMs;
    if (since >= 2 * step) return { stage: 'completed', completedBy: 'ai', completedAt: new Date(sentAt + 2 * step).toISOString(), documents: [] };
    if (since >= step) return { stage: 'processing', documents: [] };
    return { stage: 'filed', documents: [] };
  }
}

const XROAD_STAGE: Record<CaseStatus, ExternalStage> = {
  awaiting_payment: 'filed',
  received: 'filed',
  in_review: 'in_review',
  completed: 'completed',
  rejected: 'rejected',
};
const XROAD_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export function externalCaseOf(found: XroadCase): ExternalCase {
  const stage = XROAD_STAGE[found.status];
  const blocked = found.steps.find((step) => step.state === 'blocked');
  return {
    stage,
    ...(stage === 'in_review' && blocked ? { blocker: { detail: blocked.note ?? blocked.label, at: blocked.at ?? found.updatedAt } } : {}),
    payment: { status: found.payment.status, amountFcfa: found.payment.amountFcfa, reference: found.payment.reference },
    ...(stage === 'completed' ? { completedBy: found.completedBy === 'administration' ? ('human' as const) : ('ai' as const), completedAt: found.updatedAt } : {}),
    documents: found.issuedDocuments.map((document) => ({ id: document.id, name: document.title, mimeType: document.mimeType, issuedAt: document.issuedAt })),
  };
}

@Injectable()
export class XroadConnector implements AdministrationConnector, OnModuleInit {
  readonly id = 'xroad';

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    private readonly registry: ConnectorRegistry,
    private readonly xroad: XroadClient,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  supports(): boolean {
    return this.config.procedureSource === 'xroad';
  }

  async submit(input: SubmissionInput): Promise<SubmissionResult> {
    const documents = input.documents.map(({ documentType, file }) => {
      if (!XROAD_MIME_TYPES.has(file.mimeType)) throw new ProblemError(409, 'REQUEST_INCOMPLETE', `Pièce ${documentType} dans un format refusé par l'administration`);
      return { documentType, fileId: file.id, mimeType: file.mimeType, sizeBytes: file.sizeBytes };
    });
    const created = await this.xroad.createCase(
      input.userRef,
      { requestId: input.requestId, procedureId: input.procedure.id, fields: input.fields, documents },
      { traceId: input.traceId },
    );
    return { kind: 'submitted', externalRef: created.id, receipt: { reference: created.reference, receivedAt: created.createdAt }, state: externalCaseOf(created) };
  }

  async status(externalRef: string, context: TrackingContext): Promise<ExternalCase> {
    return externalCaseOf(await this.xroad.getCase(context.userRef, externalRef, context.requestId, context));
  }

  async decide(externalRef: string, input: DecisionInput, context: TrackingContext): Promise<ExternalCase> {
    return externalCaseOf(await this.xroad.decide(externalRef, context.requestId, input, context));
  }

  async document(externalRef: string, documentId: string, context: TrackingContext): Promise<Buffer> {
    return this.xroad.issuedDocument(context.userRef, externalRef, documentId, context);
  }
}
