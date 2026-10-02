#!/usr/bin/env node
/**
 * The plugin's MCP entry: one launcher, wherever the plugin was loaded from.
 *
 * `.mcp.json` points at this file through `${CLAUDE_PLUGIN_ROOT}`, so the
 * declaration never addresses a path outside the plugin. The router resolves
 * from the plugin folder first (the workspace copy, when the plugin is read
 * live from this monorepo), then from the open project (a brand's installed
 * `@omega.js/mcp-router`, when the plugin was fetched from GitHub). With
 * neither, it serves an empty tool list, so a folder with no brand shows no
 * failed server. Stdout is the MCP wire: notes go to stderr only.
 */

const readline = require('node:readline');

const ROUTER_BIN = '@omega.js/mcp-router/cli';
// The MCP stdio wire: one JSON-RPC message per line.
const METHOD_NOT_FOUND = -32601;

function resolveRouter() {
  for (const from of [__dirname, process.cwd()]) {
    try {
      return require.resolve(ROUTER_BIN, { paths: [from] });
    } catch {
      // Not installed around this folder: try the next one.
    }
  }
  return null;
}

/**
 * Answer the handshake and `tools/list` with nothing, and exit 0 when Claude
 * Code closes the input.
 */
function serveNoTools() {
  process.stderr.write(`[mcp-router] no ${ROUTER_BIN} beside the plugin or in ${process.cwd()}: serving no tools\n`);
  const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const results = {
    initialize: (params) => ({
      protocolVersion: params?.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'mcp-router', version: require('./.claude-plugin/plugin.json').version },
    }),
    'tools/list': () => ({ tools: [] }),
    ping: () => ({}),
  };

  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    // A notification carries no id and gets no answer.
    if (message.id === undefined) {
      return;
    }
    const answer = results[message.method];
    send(answer
      ? { id: message.id, result: answer(message.params) }
      : { id: message.id, error: { code: METHOD_NOT_FOUND, message: `Method not found: ${message.method}` } });
  });
  lines.on('close', () => process.exit(0));
}

const entry = resolveRouter();
if (entry) {
  require(entry);
} else {
  serveNoTools();
}
