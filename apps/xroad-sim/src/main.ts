import { ConfigError, loadConfig } from './config.js';
import { PgDatabase } from './database.js';
import { createXroadServer } from './server.js';

try {
  const config = loadConfig();
  const db = new PgDatabase(config.databaseUrl);
  const running = await createXroadServer(config, db).listen();
  console.log(`X-Road simulé sur ${running.url} (catalogue ${config.catalogueFile})`);
  const stop = () => {
    void running
      .close()
      .then(() => db.close())
      .then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (process.platform === 'win32') process.once('SIGBREAK', stop);
} catch (error) {
  console.error(error instanceof ConfigError ? `Configuration invalide : ${error.message}` : error);
  process.exit(1);
}
