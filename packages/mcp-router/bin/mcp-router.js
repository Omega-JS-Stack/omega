#!/usr/bin/env node
/**
 * The router bin — `npx -y @omega.js/mcp-router` picks the bin whose name
 * matches the unscoped package name, so THIS is the one the plugin's
 * .mcp.json launches. Requiring the module starts the stdio server.
 */

if (!require('../src/ensure-deps.js').ensureDeps()) process.exit(1);
require('../src/router.js');
