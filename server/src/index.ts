import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase, run } from './db.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const app = createApp({ db, config, now: () => new Date() });
const server = app.listen(config.port, () => {
  process.stdout.write(`Mess API ready at http://localhost:${config.port}\n`);
});
server.requestTimeout = 30000;
server.headersTimeout = 35000;
const cleanup = setInterval(() => {
  const now = new Date().toISOString();
  run(db, 'DELETE FROM sessions WHERE expires_at<=?', now);
  run(db, 'DELETE FROM meal_passes WHERE expires_at<=?', now);
}, 15 * 60000);
cleanup.unref();
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(cleanup);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => { server.closeAllConnections(); db.close(); process.exit(1); }, 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
