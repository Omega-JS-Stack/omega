#!/usr/bin/env node
/**
 * An upstream shaped like the real problem: the process the router spawns is
 * only the ROOT of a tree. This one starts a long-lived grandchild (a browser,
 * in the shape that burned a day of cores) and UNREFS it, so the root itself
 * still goes away the moment its stdin ends — exactly how an `npx` wrapper
 * dies and leaves the real server behind.
 *
 * Both pids go to the file named by TREE_MARKER, so the test can check each
 * one directly instead of guessing at a process tree that no longer exists.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

// Long-lived and quiet: it holds its own loop open and never writes anywhere.
// The timer is also its own deadline — a run that goes red before the router
// reaps this tree must not leave a process on the machine.
const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 30000)'], { stdio: 'ignore' });
grandchild.unref();

fs.writeFileSync(process.env.TREE_MARKER, `${JSON.stringify({ server: process.pid, grandchild: grandchild.pid })}\n`);

const server = new Server({ name: 'tree-server', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'ping', description: 'Answer with pong.', inputSchema: { type: 'object', properties: {} } }],
}));

server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'pong' }] }));

server.connect(new StdioServerTransport());
