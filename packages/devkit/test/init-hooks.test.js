/**
 * The test/_init.js lifecycle hook: devkit's one loader, shared by the
 * runner-core frameworks and web's test command. Real hook files in a temp
 * tree, no stand-ins.
 *
 * Run: node --test packages/devkit/test/init-hooks.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runInitSetups } = require('../src/test/init-hooks.js');

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'init-hooks-'));
  for (const [relative, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), contents);
  }
  return root;
}

// Each hook appends its label and the projectRoot it saw, so order and argument are both on disk.
const hook = (label) => `module.exports = (ctx) => ({ async setup({ projectRoot }) {
  require('fs').appendFileSync(require('path').join(ctx.projectRoot, 'setups.log'), '${label} ' + projectRoot + '\\n');
} });\n`;

test('every hook runs its setup once, in the order given, with the project root', async () => {
  const root = tree({ 'framework/_init.js': hook('framework'), 'test/_init.js': hook('project') });

  await runInitSetups([
    { dir: path.join(root, 'framework'), label: 'framework' },
    { dir: path.join(root, 'test'), label: 'project' },
  ], root);

  assert.equal(fs.readFileSync(path.join(root, 'setups.log'), 'utf8'), `framework ${root}\nproject ${root}\n`);
});

test('a test root with no _init.js is a no-op', async () => {
  const root = tree({ 'test/top.test.js': '' });

  await runInitSetups([{ dir: path.join(root, 'test'), label: 'project' }], root);

  assert.equal(fs.existsSync(path.join(root, 'setups.log')), false);
});
