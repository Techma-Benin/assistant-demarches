import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { ToolRegistry } from '../gateway/tool-registry.js';
import { XroadClient, type Procedure } from '../xroad/xroad.client.js';

@Injectable()
class ProcedureTools implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly xroad: XroadClient,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      {
        name: 'procedures.search',
        prepare: async (args, call) => ({ items: await this.xroad.searchProcedures(args.query as string, call.trace) }),
        run: async (_args, call) => call.prepared as { items: Procedure[] },
      },
      {
        name: 'procedures.get',
        prepare: (args, call) => this.xroad.getProcedure(args.procedureId as string, call.trace),
        run: async (_args, call) => call.prepared as Procedure,
      },
    );
  }
}

@Module({ providers: [ProcedureTools] })
export class ProceduresModule {}
