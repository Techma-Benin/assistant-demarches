import { Global, Injectable, Module } from '@nestjs/common';
import type { TraceContext } from '../common/trace.js';
import { tools, type ToolContext } from '../contracts.js';
import type { Tx } from '../database/database.js';
import type { EventData } from '../events/outbox.js';

export interface MandateGrantView {
  id: string;
  scopes: string[];
}

export interface PreparationContext {
  context: ToolContext;
  trace: TraceContext;
  idempotencyKey?: string;
  read<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface ToolInvocation<P = unknown> {
  context: ToolContext;
  trace: TraceContext;
  tx: Tx;
  prepared: P;
  requireMandate(procedureId: string): Promise<MandateGrantView>;
  emit(data: EventData): void;
}

export interface ToolHandler<P = unknown> {
  readonly name: string;
  prepare?(args: Record<string, unknown>, call: PreparationContext): Promise<P>;
  run(args: Record<string, unknown>, call: ToolInvocation<P>): Promise<unknown>;
}

@Injectable()
export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler<any>>();

  register(...handlers: ToolHandler<any>[]): void {
    for (const handler of handlers) {
      if (!tools.has(handler.name)) throw new Error(`Outil hors catalogue : ${handler.name}`);
      if (this.handlers.has(handler.name)) throw new Error(`Outil inscrit deux fois : ${handler.name}`);
      this.handlers.set(handler.name, handler);
    }
  }

  get(name: string): ToolHandler<any> | undefined {
    return this.handlers.get(name);
  }
}

@Global()
@Module({ providers: [ToolRegistry], exports: [ToolRegistry] })
export class ToolRegistryModule {}
