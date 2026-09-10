#!/usr/bin/env node
/**
 * An upstream that will not go politely: stdin's EOF does not end it and
 * SIGTERM is swallowed, so the SDK's close() has to walk its whole escalation
 * (stdin end → 2s → SIGTERM → 2s → SIGKILL) before the child is gone.
 *
 * A close that takes seconds is what makes the WINDOW inside a close
 * observable from the outside — the window a call used to land in and fail,
 * against a client that was already closing.
 *
 * The one timer both holds the loop open and guarantees the process cannot
 * outlive a test run, whatever a run does to the router above it.
 */

const fs = require('node:fs');

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

if (process.env.SLEEP_PID_FILE) fs.appendFileSync(process.env.SLEEP_PID_FILE, `${process.pid}\n`);

process.on('SIGTERM', () => {});
setTimeout(() => process.exit(0), 30000);

const server = new Server({ name: 'stubborn-server', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'ping', description: 'Answer with pong.', inputSchema: { type: 'object', properties: {} } }],
}));

server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'pong' }] }));

server.connect(new StdioServerTransport());
