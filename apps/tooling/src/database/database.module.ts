import { Global, Inject, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { TOOLING_CONFIG, type ToolingConfig } from '../config.js';
import { Database, PgDatabase, PgliteDatabase } from './database.js';
import { migrate } from './migrations.js';

async function openDatabase(config: ToolingConfig): Promise<Database> {
  if (config.database.kind === 'pglite') {
    const { PGlite } = await import('@electric-sql/pglite');
    return new PgliteDatabase(await PGlite.create(config.database.dataDir));
  }
  const { default: pg } = await import('pg');
  return new PgDatabase(
    new pg.Pool({
      connectionString: config.database.url,
      max: config.database.poolMax,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
      application_name: 'techma-tooling',
    }),
  );
}

@Global()
@Module({
  providers: [{ provide: Database, inject: [TOOLING_CONFIG], useFactory: openDatabase }],
  exports: [Database],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(Database) private readonly db: Database) {}

  async onModuleInit(): Promise<void> {
    await migrate(this.db);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
  }
}
