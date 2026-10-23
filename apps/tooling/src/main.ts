import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.port, config.host);
console.log(`Tooling à l'écoute sur http://${config.host}:${config.port} (auth ${config.authMode})`);
