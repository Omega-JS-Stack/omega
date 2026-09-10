#!/usr/bin/env node
/**
 * A depth-2 upstream: the child the router spawns starts a MIDDLE process,
 * which starts a LEAF. The root and the middle both die when the router closes
 * this upstream; the leaf is what survives, two levels down and reparented,
 * which is why the capture taken before a close has to be the WHOLE tree.
 *
 * The middle is unref'd, so this root still exits the moment its stdin ends —
 * exactly how an `npx` wrapper goes and leaves the rest behind.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const mid = spawn(process.execPath, [path.join(__dirname, 'deep-mid.js')], { stdio: 'ignore' });
mid.unref();

const server = new Server({ name: 'deep-tree-server', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'ping', description: 'Answer with pong.', inputSchema: { type: 'object', properties: {} } }],
}));

server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'pong' }] }));

server.connect(new StdioServerTransport());
