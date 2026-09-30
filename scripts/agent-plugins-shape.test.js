/**
 * The shape hook (PreToolUse Write|Edit): the mirrored-suite-shape guard.
 * Run: node --test scripts/agent-plugins-shape.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { ROOT, readJson, project } = require('./agent-plugins-fixtures');

const SHAPE_HOOK = path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'shape', 'run.sh');

const shape = (filePath) => spawnSync(SHAPE_HOOK, {
  input: JSON.stringify({ tool_input: { file_path: filePath } }),
  encoding: 'utf8',
});

test('shape: the three always-wrong test shapes bounce in an omega project', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  for (const bad of ['__tests__/x.test.js', 'foo.spec.js', 'test/tests/x.test.js']) {
    const result = shape(path.join(dir, bad));
    assert.equal(result.status, 2, `${bad} did not bounce`);
    assert.match(result.stderr, /omega:shape/, `${bad} bounce lacks the hook name`);
    assert.match(result.stderr, /test\/<mirror>\/<name>\.test\.js/, `${bad} bounce lacks the fix`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shape: the sanctioned shape passes untouched', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/desktop': '^1.0.0' } });
  for (const good of ['test/build/x.test.js', 'src/test/suites/main/x.test.js', 'src/lib/helper.js']) {
    assert.equal(shape(path.join(dir, good)).status, 0, `${good} was bounced`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shape: projects without @omega.js deps are never policed', () => {
  const dir = project({ name: 'somebody-else', dependencies: { react: '^19.0.0' } });
  assert.equal(shape(path.join(dir, '__tests__/x.test.js')).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shape: hooks.json wires the guard as PreToolUse on Write|Edit', () => {
  const hooks = readJson(path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'hooks.json')).hooks;
  const entry = hooks.PreToolUse.find((h) => h.matcher === 'Write|Edit');
  assert.ok(entry, 'no PreToolUse Write|Edit entry');
  assert.match(entry.hooks[0].command, /hooks\/shape\/run\.sh/);
});
