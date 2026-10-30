#!/usr/bin/env node
/**
 * The management CLI bin — `omega-mcp list|enable|disable|add|remove|refresh`.
 * Requiring the module runs the command named by argv.
 */

if (!require('../dist/ensure-deps.js').ensureDeps()) process.exit(1);
require('../dist/cli.js').main();
