import http from 'node:http';
import { notifyReady, startHeartbeat } from '../../src/runtime/worker-guards.js';

startHeartbeat(100);
const server = http.createServer((req, res) => {
  if (req.url === '/crash') process.exit(1);
  if (req.url === '/hang') {
    for (;;) {
    }
  }
  res.writeHead(200).end(String(process.pid));
});
server.listen(Number(process.env.FIXTURE_PORT), '127.0.0.1', notifyReady);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
