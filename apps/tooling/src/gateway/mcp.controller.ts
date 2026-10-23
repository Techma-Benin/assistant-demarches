import { All, Controller, Module, Post, Req, Res } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { ServiceAuth } from '../auth/service-auth.js';
import { ProblemError, toProblem } from '../common/problem.js';
import { traceOf } from '../common/trace.js';
import { catalog, domainValidator, type ToolContext } from '../contracts.js';
import { ToolExecutor } from './tool-executor.js';

const validateContext = domainValidator('ToolContext');

function singleHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Passerelle MCP Streamable HTTP, sans session : chaque POST est authentifié et porte
 * son contexte en en-têtes, construits par le Backend hors du modèle.
 */
@Controller('mcp')
export class McpController {
  constructor(
    private readonly auth: ServiceAuth,
    private readonly executor: ToolExecutor,
  ) {}

  @Post()
  async post(@Req() req: Request, @Res() res: Response): Promise<void> {
    const principal = await this.auth.require(singleHeader(req, 'authorization'), 'backend-agent', 'tools:call');
    const trace = traceOf(req);
    const mandateId = singleHeader(req, 'x-mandate-id');
    const context: ToolContext = {
      conversationId: singleHeader(req, 'x-conversation-id') ?? '',
      userRef: singleHeader(req, 'x-user-ref') ?? '',
      traceId: trace.traceId,
      ...(mandateId === undefined ? {} : { mandateId }),
    };
    if (!validateContext(context)) throw new ProblemError(400, 'INVALID_REQUEST', 'Contexte MCP invalide ou absent');
    const idempotencyKey = singleHeader(req, 'idempotency-key');

    const server = new Server({ name: 'techma-tooling', version: catalog.version }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: catalog.tools }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const output = await this.executor.execute({
          name: request.params.name,
          args: request.params.arguments ?? {},
          context,
          trace,
          actor: principal.client,
          idempotencyKey,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
      } catch (error) {
        // Erreur métier visible par l'agent ; jamais transformée en succès.
        const { code, detail } = toProblem(error);
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ code, detail, traceId: trace.traceId }) }] };
      }
    });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  /** Pas de flux SSE ni de session à fermer : seul POST est servi. */
  @All()
  other(@Res() res: Response): void {
    res.setHeader('Allow', 'POST');
    throw new ProblemError(405, 'INVALID_REQUEST', 'Méthode non prise en charge ; utiliser POST');
  }
}

@Module({ controllers: [McpController], providers: [ToolExecutor] })
export class GatewayModule {}
