/**
 * The demo-project test has one home, `isDemoProject` in @omega.js/config: a
 * `demo-*` project id is local only. This reads each source file that asks the
 * question as text and holds it to the helper, because the claim is about
 * what the source says.
 * Run: node --test scripts/demo-project-check.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGES = path.resolve(__dirname, '..', 'packages');

const FILES = [
  'backend/src/test/test-accounts.js',
  'backend/src/cli/commands/serve.js',
  'backend/src/cli/commands/setup-tests/base-test.js',
  'web/src/firebase-auth-helpers.js',
];

// A prefix test on the literal, in any of the forms a hand-written check takes
const HAND_WRITTEN = [
  /startsWith\(\s*['"`]demo-['"`]\s*\)/,
  /\/\^demo-/,
  /\.(?:slice|substring|substr)\(\s*0\s*,\s*5\s*\)\s*===?\s*['"`]demo-['"`]/,
  /indexOf\(\s*['"`]demo-['"`]\s*\)\s*===?\s*0/,
];

for (const file of FILES) {
  test(`case 12: ${file} reads isDemoProject from @omega.js/config, with no demo- test of its own`, () => {
    const text = fs.readFileSync(path.join(PACKAGES, file), 'utf8');

    assert.deepEqual(HAND_WRITTEN.filter((pattern) => pattern.test(text)).map(String), [], 'a hand-written demo- test');
    assert.match(text, /require\(\s*['"]@omega\.js\/config['"]\s*\)/, 'it requires @omega.js/config');
    // Called with a project id: a getter of the same name is not a call
    assert.match(text, /\bisDemoProject\(\s*[^)\s]/, 'it calls isDemoProject');
  });
}
