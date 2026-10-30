import { ConfigError, loadConfig } from './config.js';
import { createXroadServer } from './server.js';

try {
  const config = loadConfig();
  const running = await createXroadServer(config).listen();
  console.log(`X-Road simulé sur ${running.url} (authentification ${config.authMode}, historique ${config.seedHistory ? 'fictif chargé' : 'vide'})`);
  const stop = () => {
    void running.close().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (process.platform === 'win32') process.once('SIGBREAK', stop);
} catch (error) {
  console.error(error instanceof ConfigError ? `Configuration invalide : ${error.message}` : error);
  process.exit(1);
}
