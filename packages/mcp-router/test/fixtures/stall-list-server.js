#!/usr/bin/env node
/**
 * An upstream for refresh-timeout.test.js that completes the MCP handshake and
 * then STALLS on the tools/list read: the third of the refresh one-shot's
 * failure shapes (hang-server.js never handshakes; broken-list-server.js
 * answers the read with an error).
 *
 * It deviates from broken-list-server.js on exactly one point: the handler
 * returns a promise that never settles, so nothing but a request deadline ever
 * ends the read. That is what the router's own budget has to answer, instead of
 * the client waiting out the SDK's 60s default. This process stays alive
 * meanwhile, so a refresh that does not close its transport leaves the child
 * running.
 *
 * Extra argv is accepted and ignored: the test passes a unique tag argument as
 * its pgrep handle for child-liveness checks.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const server = new Server({ name: 'stall-list-server', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, () => new Promise(() => {}));

server.connect(new StdioServerTransport());
