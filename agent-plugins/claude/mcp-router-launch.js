#!/usr/bin/env node
/**
 * The plugin's MCP entry — ONE launcher, correct in both eras
 * ([#144](https://github.com/Omega-JS-Stack/omega/issues/144)).
 *
 * `.mcp.json` points at this file through `${CLAUDE_PLUGIN_ROOT}`, so the
 * declaration never addresses a path outside the plugin. Node resolution from
 * the plugin's OWN directory then finds the router wherever it lives: the
 * workspace copy when the plugin is read live from this monorepo, and the
 * installed `@omega.js/mcp-router` — wherever npm hoisted it — when the plugin
 * is vendored into `@omega.js/manager` inside a consumer brand.
 *
 * The router package declares no `exports` map, so its bin is resolvable by
 * subpath; requiring it starts the stdio server (which self-bootstraps its own
 * dependencies on a bare checkout). Stdout is the MCP wire — the failure path
 * speaks on stderr only, in the router's own voice.
 */

const ROUTER_BIN = '@omega.js/mcp-router/bin/mcp-router.js';

let entry;
try {
  entry = require.resolve(ROUTER_BIN, { paths: [__dirname] });
} catch {
  process.stderr.write(`[mcp-router fatal] cannot resolve ${ROUTER_BIN} from ${__dirname} — install @omega.js/mcp-router beside the plugin\n`);
  process.exit(1);
}

require(entry);
