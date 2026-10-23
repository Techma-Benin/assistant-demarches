import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Database } from './database/database.js';
import { pendingMigrations } from './database/migrations.js';

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
    }
    res.status(503);
    return { status: 'unavailable' };
  }
}
