#!/usr/bin/env node
import { bootstrap } from './server.js';

bootstrap().catch((error: unknown) => {
  console.error('Failed to bootstrap remote-server-mcp:', error);
  process.exit(1);
});
