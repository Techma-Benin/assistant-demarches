import { Injectable } from '@nestjs/common';
import { ProblemError } from '../common/problem.js';
import type { Tx } from '../database/database.js';

export interface Mandate {
  id: string;
  conversationId: string;
  userRef: string;
  procedureId: string;
  scopes: string[];
  status: 'active' | 'revoked' | 'expired';
  expiresAt: string;
}

interface MandateRow {
  id: string;
  conversation_id: string;
  user_ref: string;
  procedure_id: string;
  scopes: string[];
  status: 'active' | 'revoked';
  expires_at: Date | string;
}

export const toMandate = (row: MandateRow, now = Date.now()): Mandate => {
  const expiresAt = new Date(row.expires_at);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userRef: row.user_ref,
    procedureId: row.procedure_id,
    scopes: row.scopes,
    status: row.status === 'active' && expiresAt.getTime() <= now ? 'expired' : row.status,
    expiresAt: expiresAt.toISOString(),
  };
};

export interface NewMandate {
  id: string;
  challengeId: string;
  conversationId: string;
  userRef: string;
  procedureId: string;
  scopes: string[];
  evidenceRef: string;
  acceptedAt: string;
  expiresAt: string;
}

const COLUMNS = 'id, conversation_id, user_ref, procedure_id, scopes, status, expires_at';

@Injectable()
export class MandatesRepository {
  async requireForTool(tx: Tx, ctx: { mandateId?: string; conversationId: string; userRef: string }, scopes: string[], procedureId: string): Promise<Mandate> {
    if (!ctx.mandateId) throw new ProblemError(403, 'MANDATE_MISSING', 'Mandat requis pour cette action');
    const [row] = await tx.query<MandateRow>(`select ${COLUMNS} from mandates where id = $1 for share`, [ctx.mandateId]);
    if (!row) throw new ProblemError(403, 'MANDATE_MISSING', 'Mandat inconnu');
    const mandate = toMandate(row);
    if (mandate.status === 'revoked') throw new ProblemError(403, 'MANDATE_REVOKED', 'Mandat révoqué');
    if (mandate.status === 'expired') throw new ProblemError(403, 'MANDATE_EXPIRED', 'Mandat expiré');
    if (mandate.userRef !== ctx.userRef || mandate.conversationId !== ctx.conversationId || mandate.procedureId !== procedureId || !scopes.every((scope) => mandate.scopes.includes(scope))) {
      throw new ProblemError(403, 'MANDATE_SCOPE_DENIED', 'Portée ou propriétaire incompatible');
    }
    return mandate;
  }

  async insert(tx: Tx, mandate: NewMandate): Promise<Mandate | undefined> {
    const [row] = await tx.query<MandateRow>(
      `insert into mandates (id, challenge_id, conversation_id, user_ref, procedure_id, scopes, status, evidence_ref, accepted_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9)
       on conflict (challenge_id) do nothing
       returning ${COLUMNS}`,
      [mandate.id, mandate.challengeId, mandate.conversationId, mandate.userRef, mandate.procedureId, mandate.scopes, mandate.evidenceRef, mandate.acceptedAt, mandate.expiresAt],
    );
    return row ? toMandate(row) : undefined;
  }

  async revoke(tx: Tx, id: string): Promise<Mandate | undefined> {
    const [row] = await tx.query<MandateRow>(
      `update mandates set status = 'revoked', revoked_at = coalesce(revoked_at, now()) where id = $1 returning ${COLUMNS}`,
      [id],
    );
    return row ? toMandate(row) : undefined;
  }
}
