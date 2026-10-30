import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { ProblemError } from '../common/problem.js';
import type { TraceContext } from '../common/trace.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { ToolRegistry, type ToolHandler } from '../gateway/tool-registry.js';
import { BackendResourcesClient, type Procedure } from '../resources/backend-resources.client.js';
import { ResourcesModule } from '../resources/resources.module.js';
import { XroadClient } from '../xroad/xroad.client.js';

@Injectable()
export class ProcedureCatalog {
  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    private readonly resources: BackendResourcesClient,
    private readonly xroad: XroadClient,
  ) {}

  /** Where procedures come from: the Backend's sheets (v1) or the simulated X-Road catalogue (C5). */
  private get source(): Pick<BackendResourcesClient, 'searchProcedures' | 'getProcedure'> {
    return this.config.procedureSource === 'xroad' ? this.xroad : this.resources;
  }

  async search(query: string, trace: TraceContext): Promise<Procedure[]> {
    return (await this.source.searchProcedures(query, trace)).filter((procedure) => this.visible(procedure));
  }

  async get(procedureId: string, trace: TraceContext): Promise<Procedure> {
    const procedure = await this.source.getProcedure(procedureId, trace);
    if (!this.visible(procedure)) throw new ProblemError(404, 'NOT_FOUND', 'Fiche inconnue');
    return procedure;
  }

  private visible(procedure: Procedure): boolean {
    return this.config.allowDraftProcedures || procedure.validationStatus === 'validated';
  }
}

@Injectable()
class ProcedureTools implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly catalog: ProcedureCatalog,
  ) {}

  onModuleInit(): void {
    const search: ToolHandler<Procedure[]> = {
      name: 'procedures.search',
      prepare: (args, call) => this.catalog.search(args.query as string, call.trace),
      run: async (_args, call) => ({ items: call.prepared }),
    };
    const get: ToolHandler<Procedure> = {
      name: 'procedures.get',
      prepare: (args, call) => this.catalog.get(args.procedureId as string, call.trace),
      run: async (_args, call) => call.prepared,
    };
    this.registry.register(search, get);
  }
}

@Module({
  imports: [ResourcesModule],
  providers: [ProcedureCatalog, ProcedureTools],
  exports: [ProcedureCatalog],
})
export class ProceduresModule {}
