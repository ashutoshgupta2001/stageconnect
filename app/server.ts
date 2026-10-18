import { pino } from 'pino';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { createApp } from './app.js';
async function main() {
  const config = loadConfig();
  const logger = pino({ level: config.LOG_LEVEL });
  const container = await createContainer(config);
  await container.db.authenticate();
  const app = createApp(config, container, { logger });
  const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'StageConnect listening'));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000).unref();
    server.close(() => {
      void container.db.close().then(() => { clearTimeout(deadline); process.exit(0); });
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  server.on('error', () => {
    logger.error('HTTP server failed to start.');
    void container.db.close().finally(() => process.exit(1));
  });
}
main().catch(() => {
  // Config errors must not echo environment values, credentials or database URLs.
  console.error('Startup failed. Check environment configuration, database access, and applied migrations.');
  process.exit(1);
});

