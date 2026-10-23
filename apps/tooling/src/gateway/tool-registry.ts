import { Global, Injectable, Module } from '@nestjs/common';
import type { TraceContext } from '../common/trace.js';
import { tools, type ToolContext } from '../contracts.js';
import type { Tx } from '../database/database.js';
import type { EventData } from '../events/outbox.js';

export interface MandateGrantView {
  id: string;
  scopes: string[];
}

/** Ce qu'un outil reçoit : contexte hors modèle, transaction à portée de l'usager, garde-fous. */
export interface ToolInvocation {
  context: ToolContext;
  trace: TraceContext;
  tx: Tx;
  /** Obligatoire pour tout outil d'action ; la passerelle refuse un outil d'action qui l'omet. */
  requireMandate(procedureId: string): Promise<MandateGrantView>;
  /** Événement C4 écrit dans la même transaction que l'effet. */
  emit(data: EventData): void;
}

export interface ToolHandler {
  readonly name: string;
  run(args: Record<string, unknown>, call: ToolInvocation): Promise<unknown>;
}

/**
 * Les modules fonctionnels inscrivent leurs outils ici au démarrage ;
 * la passerelle ne connaît aucun outil en particulier.
 */
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
