#!/usr/bin/env node
import { loadConfig } from '../src/server/config.js';
import { createServices } from '../src/services/index.js';
import { createHttpServer } from '../src/server/http-server.js';

const config = loadConfig();
const services = createServices(config);
const server = createHttpServer(config, services);
server.listen(config.port, config.host, () => {
  process.stdout.write(`Workbench Generator: http://${config.host}:${config.port}\n`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => { services.store.close(); process.exit(0); }));
}
