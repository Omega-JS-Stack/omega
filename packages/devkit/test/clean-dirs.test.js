/**
 * clean-dirs tests — dirs with content are emptied and recreated, missing
 * dirs are created, and paths with spaces survive the shell round-trip.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { cleanDirs } = require('../src/clean-dirs.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

test('clean-dirs: empties existing dirs, creates missing ones, handles spaces', (t) => {
  const root = path.join(TEMP_ROOT, `clean-dirs-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const full = path.join(root, 'dist');
  const spaced = path.join(root, 'with space');
  const missing = path.join(root, 'never-existed');

  fs.mkdirSync(path.join(full, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(full, 'nested', 'artifact.js'), 'x');
  fs.mkdirSync(spaced, { recursive: true });
  fs.writeFileSync(path.join(spaced, 'artifact.css'), 'y');

  cleanDirs([full, spaced, missing]);

  for (const dir of [full, spaced, missing]) {
    assert.equal(fs.existsSync(dir), true, `${dir} should exist`);
    assert.deepEqual(fs.readdirSync(dir), [], `${dir} should be empty`);
  }
});
