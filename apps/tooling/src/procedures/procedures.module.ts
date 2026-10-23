import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { ProblemError } from '../common/problem.js';
import type { TraceContext } from '../common/trace.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { ToolRegistry, type ToolHandler, type ToolInvocation } from '../gateway/tool-registry.js';
import { BackendResourcesClient, type Procedure } from '../resources/backend-resources.client.js';
import { ResourcesModule } from '../resources/resources.module.js';

/** Fiches vues par le Tooling. En production, seules les fiches validées existent. */
@Injectable()
export class ProcedureCatalog {
  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    private readonly resources: BackendResourcesClient,
  ) {}

  async search(query: string, trace: TraceContext): Promise<Procedure[]> {
    return (await this.resources.searchProcedures(query, trace)).filter((procedure) => this.visible(procedure));
  }

  async get(procedureId: string, trace: TraceContext): Promise<Procedure> {
    const procedure = await this.resources.getProcedure(procedureId, trace);
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
    const search: ToolHandler = {
      name: 'procedures.search',
      run: async (args, call: ToolInvocation) => ({ items: await this.catalog.search(args.query as string, call.trace) }),
    };
    const get: ToolHandler = {
      name: 'procedures.get',
      run: (args, call) => this.catalog.get(args.procedureId as string, call.trace),
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
