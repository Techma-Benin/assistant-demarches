import { Global, Injectable, Module } from '@nestjs/common';
import type { TraceContext } from '../common/trace.js';
import { tools, type ToolContext } from '../contracts.js';
import type { Tx } from '../database/database.js';
import type { EventData } from '../events/outbox.js';

export interface MandateGrantView {
  id: string;
  scopes: string[];
}

export interface ToolPreparation {
  context: ToolContext;
  trace: TraceContext;
  read<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface ToolInvocation {
  context: ToolContext;
  trace: TraceContext;
  tx: Tx;
  prepared?: unknown;
  requireMandate(procedureId: string): Promise<MandateGrantView>;
  emit(data: EventData): void;
}

export interface ToolHandler {
  readonly name: string;
  prepare?(args: Record<string, unknown>, call: ToolPreparation): Promise<unknown>;
  run(args: Record<string, unknown>, call: ToolInvocation): Promise<unknown>;
}

export type Settled<T> = { value: T } | { error: unknown };

export async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}

export function unwrap<T>(settled: Settled<T>): T {
  if ('error' in settled) throw settled.error;
  return settled.value;
}

export function inTransaction(call: ToolInvocation): ToolPreparation {
  return { context: call.context, trace: call.trace, read: (fn) => fn(call.tx) };
}

@Injectable()
export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();

  register(...handlers: ToolHandler[]): void {
    for (const handler of handlers) {
      if (!tools.has(handler.name)) throw new Error(`Outil hors catalogue : ${handler.name}`);
      if (this.handlers.has(handler.name)) throw new Error(`Outil inscrit deux fois : ${handler.name}`);
      this.handlers.set(handler.name, handler);
    }
  }

  get(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }
}

@Global()
@Module({ providers: [ToolRegistry], exports: [ToolRegistry] })
export class ToolRegistryModule {}
