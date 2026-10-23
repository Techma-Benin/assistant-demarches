import { Global, Injectable, Module } from '@nestjs/common';
import type { Tx } from '../database/database.js';

export interface AuditEntry {
  traceId: string;
  actor: string;
  action: string;
  outcome: 'success' | 'error';
  code: string;
  conversationId?: string;
  userRef?: string;
  mandateId?: string;
  requestId?: string;
}

/**
 * Journal d'audit en ajout seul. Il ne contient que des identifiants et des codes :
 * ni arguments, ni champs de formulaire, ni contenu de pièce.
 */
@Injectable()
export class AuditLog {
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.query(
      `insert into audit_log (trace_id, actor, action, outcome, code, conversation_id, user_ref, mandate_id, request_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [entry.traceId, entry.actor, entry.action, entry.outcome, entry.code, entry.conversationId ?? null, entry.userRef ?? null, entry.mandateId ?? null, entry.requestId ?? null],
    );
  }
}

@Global()
@Module({ providers: [AuditLog], exports: [AuditLog] })
export class AuditModule {}
