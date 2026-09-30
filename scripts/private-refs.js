/**
 * Self-containment scan: `node scripts/private-refs.js <dir>`.
 *
 * Walks a shipped package tree and reports every raw reference to a PRIVATE
 * @omega.js package (devkit's PRIVATE_REFERENCE, built from its
 * VENDORABLE_PACKAGES). Vendoring must have rewritten or eliminated every one;
 * published runtime deps (@omega.js/client, @omega.js/backend,
 * @omega.js/mcp-router) are legitimate package requires and never match.
 *
 * CI's pack-smoke runs the CLI on each scratch install; release-check calls
 * scanTree. Exits 1 on any hit, naming each file:line.
 */

// Libraries
const fs = require('node:fs');
const path = require('node:path');
const { PRIVATE_REFERENCE } = require('../packages/devkit/tools/vendor');

// Every match in a file, not just the first
const PRIVATE_REFERENCE_ALL = new RegExp(PRIVATE_REFERENCE.source, 'g');

/**
 * Scan a package tree for raw private @omega.js references. Walks
 * .js/.cjs/.mjs files, skipping nested node_modules, and matches whole file
 * contents so a reference split across lines still counts.
 * @param {string} dir - Installed package root.
 * @returns {{ hits: string[], files: number, bytes: number }}
 */
function scanTree(dir) {
  const hits = [];
  let files = 0;
  let bytes = 0;

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      files += 1;
      bytes += fs.statSync(full).size;
      if (!/\.(js|cjs|mjs)$/.test(entry.name)) continue;
      const contents = fs.readFileSync(full, 'utf8');
      for (const match of contents.matchAll(PRIVATE_REFERENCE_ALL)) {
        const line = contents.slice(0, match.index).split('\n').length;
        hits.push(`${path.relative(dir, full)}:${line}`);
      }
    }
  };

  walk(dir);
  return { hits, files, bytes };
}

function main() {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) {
    console.error(`private-refs: no such directory '${dir}' (usage: node scripts/private-refs.js <dir>)`);
    process.exit(1);
  }

  const { hits, files } = scanTree(dir);
  if (hits.length > 0) {
    hits.forEach((hit) => console.error(`raw private ref: ${hit}`));
    console.error(`private-refs: ${hits.length} raw private @omega.js references in ${dir}`);
    process.exit(1);
  }
  console.log(`private-refs: ${files} files, no raw private @omega.js references in ${dir}`);
}

if (require.main === module) {
  main();
}

module.exports = { scanTree };
