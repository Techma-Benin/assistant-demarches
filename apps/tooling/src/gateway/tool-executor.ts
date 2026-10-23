import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProblemError } from '../common/problem.js';
import type { TraceContext } from '../common/trace.js';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { errorsText, tools, type ToolContext } from '../contracts.js';
import { BackendResourcesClient, type Procedure } from '../resources/backend-resources.client.js';

export interface ToolCall {
  context: ToolContext;
  trace: TraceContext;
}

type Handler = (args: Record<string, unknown>, call: ToolCall) => Promise<unknown>;

/** Exécute un outil du catalogue : arguments validés, sortie conforme à outputSchema. */
@Injectable()
export class ToolExecutor {
  private readonly logger = new Logger(ToolExecutor.name);
  private readonly handlers: Record<string, Handler> = {
    'procedures.search': async (args, call) => {
      const items = await this.resources.searchProcedures(args.query as string, call.trace);
      return { items: items.filter((procedure) => this.visible(procedure)) };
    },
    'procedures.get': async (args, call) => {
      const procedure = await this.resources.getProcedure(args.procedureId as string, call.trace);
      if (!this.visible(procedure)) throw new ProblemError(404, 'NOT_FOUND', 'Fiche inconnue');
      return procedure;
    },
  };

  constructor(
    @Inject(TOOLING_CONFIG) private readonly config: ToolingConfig,
    private readonly resources: BackendResourcesClient,
  ) {}

  async execute(name: string, args: unknown, call: ToolCall): Promise<Record<string, unknown>> {
    const tool = tools.get(name);
    if (!tool) throw new ProblemError(404, 'NOT_FOUND', 'Outil inconnu');
    if (!tool.input(args)) throw new ProblemError(400, 'INVALID_REQUEST', errorsText(tool.input));

    const handler = this.handlers[name];
    if (!handler) throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Outil pas encore disponible');

    const output = await handler(args as Record<string, unknown>, call);
    if (!tool.output(output)) {
      this.logger.error(`Sortie non conforme pour ${name} : ${errorsText(tool.output)}`);
      throw new ProblemError(503, 'UPSTREAM_UNAVAILABLE', 'Réponse amont non conforme');
    }
    return output as Record<string, unknown>;
  }

  /** En production, seules les fiches validées par une administration sont exposées. */
  private visible(procedure: Procedure): boolean {
    return !this.config.production || procedure.validationStatus === 'validated';
  }
}
