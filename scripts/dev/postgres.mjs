import { existsSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';
import { DATABASES, LOCAL, PORTS, POSTGRES } from './local-config.mjs';

/** Starts the local PostgreSQL instance (real binaries from npm, no Docker) and creates one database per service. */
export async function startPostgres(log, {
  local = LOCAL, port = PORTS.postgres, databases = DATABASES, postgres = POSTGRES,
} = {}) {
  const databaseDir = `${local}postgres`;
  const pg = new EmbeddedPostgres({
    databaseDir,
    port,
    user: postgres.user,
    password: postgres.password,
    persistent: true,
    autoRehydrateSymlinks: true,
    onLog: () => {},
    onError: (error) => log(String(error).trim()),
  });
  if (!existsSync(`${databaseDir}/PG_VERSION`)) {
    log('initialisation de la base locale');
    await pg.initialise();
  }
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();
  try {
    const existing = new Set((await client.query('SELECT datname FROM pg_database')).rows.map((row) => row.datname));
    for (const name of databases) if (!existing.has(name)) await pg.createDatabase(name);
  } finally {
    await client.end();
  }
  log(`prête sur le port ${port} (bases : ${databases.join(', ')})`);
  return () => pg.stop();
}
