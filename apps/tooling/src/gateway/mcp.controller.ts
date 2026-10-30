import { All, Controller, Module, Post, Req, Res } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { RequestGuard } from '../auth/request-guard.js';
import { ProblemError, toProblem } from '../common/problem.js';
import { traceOf } from '../common/trace.js';
import { catalog, domainValidator, type ToolContext } from '../contracts.js';
import { ToolExecutor } from './tool-executor.js';

const validateContext = domainValidator('ToolContext');

function singleHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

@Controller('mcp')
export class McpController {
  constructor(
    private readonly guard: RequestGuard,
    private readonly executor: ToolExecutor,
  ) {}

  @Post()
  async post(@Req() req: Request, @Res() res: Response): Promise<void> {
    const principal = await this.guard.authorize(req, 'backend-agent', 'tools:call');
    const trace = traceOf(req);
    const mandateId = singleHeader(req, 'x-mandate-id');
    // Without any context header, the session can only discover the catalogue (adding an MCP server by URL).
    // Any supplied context must remain valid; executing an action always needs a complete context.
    const discovery = ['x-conversation-id', 'x-user-ref', 'x-mandate-id'].every((name) => req.headers[name] === undefined);
    const context: ToolContext = {
      conversationId: singleHeader(req, 'x-conversation-id') ?? '',
      userRef: singleHeader(req, 'x-user-ref') ?? '',
      traceId: trace.traceId,
      ...(mandateId === undefined ? {} : { mandateId }),
    };
    if (!discovery && !validateContext(context)) throw new ProblemError(400, 'INVALID_REQUEST', 'Contexte MCP invalide ou absent');
    const idempotencyKey = singleHeader(req, 'idempotency-key');

    const server = new Server({ name: 'techma-tooling', version: catalog.version }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: catalog.tools }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        if (discovery) throw new ProblemError(400, 'INVALID_REQUEST', 'Contexte MCP requis pour appeler un outil (X-Conversation-Id, X-User-Ref)');
        if (!validateContext(context)) throw new ProblemError(400, 'INVALID_REQUEST', 'Contexte MCP invalide ou absent');
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
        const { code, detail } = toProblem(error);
        const body = { code, detail, traceId: trace.traceId };
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(body) }] };
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

  @All()
  other(@Res() res: Response): void {
    res.setHeader('Allow', 'POST');
    throw new ProblemError(405, 'INVALID_REQUEST', 'Méthode non prise en charge ; utiliser POST');
  }
}

@Module({ controllers: [McpController], providers: [ToolExecutor] })
export class GatewayModule {}
