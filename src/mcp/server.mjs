#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './factory.js';
import { loadConfig } from '../server/config.js';
import { createServices } from '../services/index.js';

let services;
let user;
if (process.env.WORKBENCH_TOKEN) {
  const config = loadConfig(process.env);
  services = createServices(config);
  user = services.auth.authenticate(process.env.WORKBENCH_TOKEN);
}
const server = createMcpServer({ services, user, filesystemTools: true });
const transport = new StdioServerTransport();
try { await server.connect(transport); }
catch (error) {
  process.stderr.write('[workbench-mcp] ' + String(error.message || error) + '\n');
  services?.store.close();
  process.exit(1);
}
