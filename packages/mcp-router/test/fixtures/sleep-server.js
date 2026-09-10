#!/usr/bin/env node
/**
 * A real (tiny) upstream MCP server that can be SLOW on purpose: `ping`
 * answers at once, `sleep` holds the call open for the requested ms. The slow
 * tool is what makes an in-flight call observable — the idle sweep has to
 * leave a child alone while it is still answering.
 *
 * When SLEEP_PID_FILE is set the server writes its own pid there at startup,
 * which is how a test that does not speak the meta-tools (host-gone) knows
 * which child has to be gone afterwards.
 */

const fs = require('node:fs');

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const TOOLS = [
  {
    name: 'ping',
    description: 'Answer with pong.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sleep',
    description: 'Answer after the given number of milliseconds.',
    inputSchema: { type: 'object', properties: { ms: { type: 'number' } }, required: ['ms'] },
  },
];

if (process.env.SLEEP_PID_FILE) fs.writeFileSync(process.env.SLEEP_PID_FILE, `${process.pid}\n`);

const server = new Server({ name: 'sleep-server', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'sleep') return { content: [{ type: 'text', text: 'pong' }] };

  const ms = Number(request.params.arguments?.ms) || 0;
  await new Promise((resolve) => setTimeout(resolve, ms));
  return { content: [{ type: 'text', text: `slept ${ms}ms` }] };
});

server.connect(new StdioServerTransport());
