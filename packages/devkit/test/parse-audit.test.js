/**
 * parse-audit tests — the tree walker must catch SyntaxError files (including
 * the motivating case: a regex literal corrupted by a rename sweep) without
 * false-positives on valid CJS, ESM, or shebang'd sources, and without
 * descending into build-output dirs.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseAuditTree } = require('../src/parse-audit.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

function makeTree(name, files) {
  const root = path.join(TEMP_ROOT, `${name}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

function cleanup(t, root) {
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
}

test('parse-audit: catches a rename-corrupted regex literal, passes valid CJS/ESM/shebang', (t) => {
  const root = makeTree('parse-audit-mixed', {
    // Valid CJS
    'lib/good.js': `const path = require('path');\nmodule.exports = { p: path.sep };\n`,
    // Valid ESM (would fail a CJS-wrap parse — must not be reported)
    'web/module.js': `import path from 'node:path';\nexport const p = path.sep;\n`,
    // Valid CJS with shebang
    'bin/cli.js': `#!/usr/bin/env node\nconsole.log('ok');\n`,
    // The motivating casualty: unescaped / injected into a regex literal
    'cli/broken.js': `const re = /({{\\s*?@omega.js/backend\\s*?}})/sgm;\nmodule.exports = re;\n`,
  });
  cleanup(t, root);

  const { checked, failures } = parseAuditTree(root);
  assert.equal(checked, 4);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].file, path.join('cli', 'broken.js'));
  assert.match(failures[0].error, /Invalid regular expression flags|Unexpected/);
});

test('parse-audit: skips build-output dirs by default, honors custom skipDirs', (t) => {
  const root = makeTree('parse-audit-skips', {
    'src/ok.js': `module.exports = 1;\n`,
    'node_modules/dep/broken.js': `syntax error here(((\n`,
    'dist/broken.js': `also broken(((\n`,
    '_backup/broken.js': `broken too(((\n`,
  });
  cleanup(t, root);

  // Defaults: node_modules + dist skipped; _backup is NOT in the default list
  const withDefaults = parseAuditTree(root);
  assert.equal(withDefaults.checked, 2);
  assert.equal(withDefaults.failures.length, 1);
  assert.equal(withDefaults.failures[0].file, path.join('_backup', 'broken.js'));

  // Custom list replaces the defaults
  const custom = parseAuditTree(root, { skipDirs: ['node_modules', 'dist', '_backup'] });
  assert.equal(custom.checked, 1);
  assert.equal(custom.failures.length, 0);
});
