import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDeckServer } from './server.js';

// stdout carries the MCP protocol, so diagnostics must go to stderr.
const server = createDeckServer();
await server.connect(new StdioServerTransport());
console.error('Command Deck MCP server ready (stdio).');
