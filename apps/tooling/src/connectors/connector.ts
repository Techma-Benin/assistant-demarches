import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import type { FileMetadata, Procedure } from '../resources/backend-resources.client.js';

export interface SubmissionInput {
  requestId: string;
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

export interface AdministrationConnector {
  readonly id: string;
  supports(procedure: Procedure): boolean;
  submit(input: SubmissionInput): Promise<SubmissionResult>;
  status(externalRef: string, traceId: string): Promise<ExternalStatus>;
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
