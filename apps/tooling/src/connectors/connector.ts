import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ProblemError } from '../common/problem.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import type { FileMetadata, Procedure } from '../resources/backend-resources.client.js';
import { XroadClient, type CaseStatus } from '../xroad/xroad.client.js';

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

export type SubmissionResult =
  | { kind: 'submitted'; externalRef: string; receipt: Receipt }
  | { kind: 'user_action_required'; link: string };

export type ExternalStatus = 'submitted' | 'processing' | 'completed' | 'rejected';

export interface TrackingContext {
  requestId: string;
  userRef: string;
  traceId: string;
}

export interface AdministrationConnector {
  readonly id: string;
  supports(procedure: Procedure): boolean;
  submit(input: SubmissionInput): Promise<SubmissionResult>;
  status(externalRef: string, context: TrackingContext): Promise<ExternalStatus>;
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
    return { kind: 'submitted', externalRef, receipt: { reference: externalRef, receivedAt: receivedAt.toISOString() } };
  }

  async status(externalRef: string): Promise<ExternalStatus> {
    const sentAt = Number(/-(\d+)$/.exec(externalRef)?.[1]);
    if (!Number.isFinite(sentAt)) throw new Error('Référence simulée illisible');
    const since = Date.now() - sentAt;
    const step = this.config.connectors.simulatedStepMs;
    if (since >= 2 * step) return 'completed';
    if (since >= step) return 'processing';
    return 'submitted';
  }
}

const XROAD_STATUS: Record<CaseStatus, ExternalStatus> = {
  awaiting_payment: 'submitted',
  received: 'submitted',
  in_review: 'processing',
  completed: 'completed',
  rejected: 'rejected',
};
const XROAD_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

/** Files cases with the simulated X-Road (C5). Its statuses come from that service, which declares itself simulated. */
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
    return { kind: 'submitted', externalRef: created.id, receipt: { reference: created.reference, receivedAt: created.createdAt } };
  }

  async status(externalRef: string, context: TrackingContext): Promise<ExternalStatus> {
    const found = await this.xroad.getCase(context.userRef, externalRef, context.requestId, context);
    return XROAD_STATUS[found.status];
  }
}
