/**
 * `omega clean` — removes build OUTPUT and machinery (dist/, .omega/) and
 * nothing else. The blast radius is the contract: a consumer runs this on a
 * tree that holds their src/, their config, and their node_modules, so an
 * over-broad removal is unrecoverable work. Driven against a real temp
 * consumer tree with the real command.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const clean = require('../src/commands/clean.js');

// A temp consumer tree with build output present; returns its root.
function consumer(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-clean-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const files = {
    'dist/index.html': '<html></html>',
    'dist/assets/app.js': 'built',
    '.omega/asset-manifest.json': '{}',
    'src/index.md': '# home',
    'config/omega.json5': '{}',
    'package.json': '{}',
    ...extra,
  };
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

// Run the command with cwd pointed at the consumer (the command reads
// process.cwd() through consumerPaths).
async function runIn(t, root, options = {}) {
  const previous = process.cwd();
  process.chdir(root);
  t.after(() => process.chdir(previous));

  await clean(options);
  process.chdir(previous);
}

test('dist/ and .omega/ are removed; the source tree is untouched', async (t) => {
  const root = consumer(t);

  await runIn(t, root);

  assert.strictEqual(fs.existsSync(path.join(root, 'dist')), false);
  assert.strictEqual(fs.existsSync(path.join(root, '.omega')), false);
  assert.strictEqual(fs.existsSync(path.join(root, 'src', 'index.md')), true);
  assert.strictEqual(fs.existsSync(path.join(root, 'config', 'omega.json5')), true);
  assert.strictEqual(fs.existsSync(path.join(root, 'package.json')), true);
});

test('clean is idempotent — a second run on an already-clean tree is a no-op', async (t) => {
  const root = consumer(t);

  await runIn(t, root);
  await runIn(t, root);

  assert.deepStrictEqual(fs.readdirSync(root).sort(), ['config', 'package.json', 'src']);
});

test('a tree that never built cleans without error', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-clean-fresh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{}');

  await runIn(t, root);

  assert.deepStrictEqual(fs.readdirSync(root), ['package.json']);
});
