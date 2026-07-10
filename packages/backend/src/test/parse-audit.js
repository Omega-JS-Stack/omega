#!/usr/bin/env node

/**
 * Parse-audit the framework source before the suite boots anything.
 *
 * Unloaded corners (CLI commands, setup tests, scaffold machinery) must still
 * PARSE: cp73c found three setup-tests modules that had been SyntaxErrors for
 * three checkpoints — a rename sweep corrupted their regex literals — while
 * every suite stayed green because nothing ever required them.
 */

const path = require('path');
const { parseAuditTree } = require('@omega.js/devkit/parse-audit');

const { checked, failures } = parseAuditTree(path.join(__dirname, '..'));

if (failures.length > 0) {
  console.error(`[parse-audit] ${failures.length} file(s) fail to parse:`);
  for (const failure of failures) {
    console.error(`  ${failure.file} — ${failure.error}`);
  }
  process.exit(1);
}

console.log(`[parse-audit] ${checked} source files parse OK`);
