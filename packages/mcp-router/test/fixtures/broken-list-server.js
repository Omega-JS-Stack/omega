#!/usr/bin/env node
/**
 * An upstream for refresh-cleanup.test.js that completes the MCP handshake and
 * then FAILS the tools/list read: the post-handshake half of the refresh
 * one-shot's failure shapes (hang-server.js is the other half: it never
 * handshakes at all).
 *
 * It answers tools/list with an error rather than stalling on it, which is the
 * same rejection the client raises when a stalled child hits its request
 * timeout, without the test paying that timeout. What matters for the leak is
 * what happens after: this process stays alive, so a refresh that does not
 * close its transport leaves the child running.
 *
 * Extra argv is accepted and ignored: the test passes a unique tag argument as
 * its pgrep handle for child-liveness checks.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const server = new Server({ name: 'broken-list-server', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  throw new Error('tools/list is unavailable');
});

server.connect(new StdioServerTransport());
