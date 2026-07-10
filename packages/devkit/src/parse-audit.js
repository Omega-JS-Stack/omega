/**
 * Parse-audit: vm-parse every .js file under a tree WITHOUT executing it.
 *
 * Catches files that fail to PARSE in source corners no test ever loads —
 * CLI commands, scaffold templates, setup machinery. The motivating incident
 * (cp73c): a rename sweep corrupted regex literals in three backend
 * setup-tests modules, leaving them SyntaxErrors for three checkpoints while
 * every suite stayed green.
 *
 * CJS first (Module.wrap — the same wrapper node itself compiles modules
 * with); files that fail the CJS parse are re-checked as ESM via node's own
 * parser (`node --input-type=module --check`) so browser/ESM sources don't
 * false-positive. Only files failing BOTH parses are reported.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');

// Build output and dependency trees never gate a source audit
const DEFAULT_SKIP = ['node_modules', 'dist', '.temp', '.cache', 'coverage', 'packaged', 'release'];

/**
 * Recursively parse-check every .js file under rootDir.
 * @param {string} rootDir - Tree to audit (absolute or cwd-relative).
 * @param {object} [options]
 * @param {string[]} [options.skipDirs] - Directory NAMES to skip at any depth (replaces the default list).
 * @returns {{ checked: number, failures: Array<{ file: string, error: string }> }}
 *   `file` is relative to rootDir; `error` is the first line of the parse error.
 */
function parseAuditTree(rootDir, options = {}) {
  const root = path.resolve(rootDir);
  const skipDirs = new Set(options.skipDirs || DEFAULT_SKIP);

  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.js')) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  walk(root);

  const failures = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8').replace(/^#!.*/, '');

    try {
      new vm.Script(Module.wrap(source), { filename: file });
    } catch (cjsError) {
      try {
        execFileSync(process.execPath, ['--input-type=module', '--check'], {
          input: source,
          stdio: ['pipe', 'ignore', 'pipe'],
        });
      } catch (esmError) {
        failures.push({
          file: path.relative(root, file),
          error: String(cjsError.message).split('\n')[0],
        });
      }
    }
  }

  return { checked: files.length, failures };
}

module.exports = { parseAuditTree };
