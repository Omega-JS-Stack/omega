/**
 * scaffold-guard — the refusal every framework's ensure-target runs before it
 * writes ([#699](https://github.com/Omega-JS-Stack/omega/issues/699)). Real
 * directories in an os.tmpdir() scratch, no mocks.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { assertScaffoldable, nearestManifest } = require('../src/scaffold-guard.js');

/**
 * A scratch repo: `.git` at the root to bound the walk, plus whatever manifests
 * the case needs.
 * @param {Object<string, object>} manifests - Repo-relative dir → package.json contents
 * @returns {string} The repo root
 */
function stageRepo(manifests) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-guard-'));
  fs.mkdirSync(path.join(root, '.git'));
  for (const [dir, manifest] of Object.entries(manifests)) {
    const full = path.join(root, dir);
    fs.mkdirSync(full, { recursive: true });
    fs.writeFileSync(path.join(full, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return root;
}

test('assertScaffoldable: a workspace root is refused by name and reason', () => {
  const root = stageRepo({ '.': { name: 'omega', private: true, workspaces: ['packages/*'] } });

  assert.throws(() => assertScaffoldable(root), (error) => {
    assert.match(error.message, /refusing to scaffold into/);
    assert.ok(error.message.includes(root), `names the directory: ${error.message}`);
    assert.match(error.message, /declares "workspaces"/);
    assert.match(error.message, /Nothing was scaffolded/);
    return true;
  });
});

test('assertScaffoldable: a directory INSIDE a workspace root is refused too (nearest manifest)', () => {
  const root = stageRepo({ '.': { name: 'omega', workspaces: ['packages/*'] } });
  const scratchDir = path.join(root, 'scratch', 'deep');
  fs.mkdirSync(scratchDir, { recursive: true });

  assert.throws(() => assertScaffoldable(scratchDir), /refusing to scaffold into/);
});

test('assertScaffoldable: a workspace MEMBER scaffolds — it carries its own manifest', () => {
  const root = stageRepo({
    '.': { name: 'acme', workspaces: ['targets/*'] },
    'targets/app': { name: 'acme-app', devDependencies: { '@omega.js/desktop': '*' } },
  });

  assert.doesNotThrow(() => assertScaffoldable(path.join(root, 'targets', 'app')));
});

test('assertScaffoldable: a fresh directory with no manifest above it still scaffolds (bootstrap)', () => {
  const root = stageRepo({});
  const fresh = path.join(root, 'my-app');
  fs.mkdirSync(fresh);

  assert.doesNotThrow(() => assertScaffoldable(fresh));
});

test('nearestManifest: the walk stops at the nearest .git — a manifest outside the repo is never adopted', () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-guard-outer-'));
  fs.writeFileSync(path.join(outer, 'package.json'), JSON.stringify({ name: 'outer', workspaces: ['*'] }));
  const repo = path.join(outer, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });

  assert.equal(nearestManifest(repo), null);
  assert.doesNotThrow(() => assertScaffoldable(repo));
});
