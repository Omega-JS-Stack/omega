#!/usr/bin/env node
/**
 * A real (tiny) upstream MCP server for the tests — two tools, one of which
 * echoes its argument. Used wherever a test needs a genuine stdio child
 * rather than a stub: the CLI's refresh path, and any cold-call proof.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo the text back.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'ping',
    description: 'Answer with pong.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const server = new Server({ name: 'echo-server', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: 'text', text: request.params.name === 'echo' ? String(request.params.arguments?.text) : 'pong' }],
}));

server.connect(new StdioServerTransport());
