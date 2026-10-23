import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Database } from './database/database.js';
import { pendingMigrations } from './database/migrations.js';

/**
 * Sondes de l'orchestrateur. /health : le processus répond (redémarrage sinon).
 * /ready : la base répond et le schéma est à jour (retrait du trafic sinon).
 * Le Backend n'entre pas dans /ready : sa panne ne doit pas faire tomber le Tooling.
 */
@Controller()
export class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HttpCode(200)
  async ready(@Res({ passthrough: true }) res: Response): Promise<{ status: 'ready' | 'unavailable' }> {
    try {
      await this.db.ping();
      if ((await pendingMigrations(this.db)) === 0) return { status: 'ready' };
    } catch {
      // Détail dans les journaux de la base ; la sonde ne renvoie qu'un état.
    }
    res.status(503);
    return { status: 'unavailable' };
  }
}
