import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from './config.js';
import { supervise } from './runtime/supervisor.js';

try {
  const config = loadConfig();
  supervise({ workers: config.workers, exec: fileURLToPath(new URL('./main.js', import.meta.url)) });
} catch (error) {
  console.error(`[superviseur] ${error instanceof ConfigError ? 'Configuration invalide' : 'Démarrage impossible'} : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
