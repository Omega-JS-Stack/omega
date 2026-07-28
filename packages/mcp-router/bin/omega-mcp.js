#!/usr/bin/env node
/**
 * The management CLI bin — `omega-mcp list|enable|disable|add|remove|refresh`.
 * Requiring the module runs the command named by argv.
 */

if (!require('../src/ensure-deps.js').ensureDeps()) process.exit(1);
require('../src/cli.js').main();
