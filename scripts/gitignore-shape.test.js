/**
 * gitignore-shape tests: one ignore pattern for the whole tree.
 *
 * A line the whole tree needs, or that more than one package needs, lives once
 * in the root .gitignore. A package's .gitignore holds only what is its own, so
 * a package line that repeats a root or sibling pattern is a second copy that
 * will drift, and fails here.
 *
 * Run: node --test scripts/gitignore-shape.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');

// The pattern lines of a .gitignore, with the anchoring slashes dropped so
// `/.cache/`, `.cache/` and `.cache` compare as one pattern.
function patterns(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
    .map((line) => line.replace(/^\//, '').replace(/\/$/, ''));
}

function packageIgnores() {
  return fs.readdirSync(PACKAGES_DIR)
    .map((name) => ({ name, file: path.join(PACKAGES_DIR, name, '.gitignore') }))
    .filter(({ file }) => fs.existsSync(file));
}

test('patterns() treats anchored and unanchored spellings as one pattern', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gitignore-shape-'));
  const file = path.join(tmp, '.gitignore');
  fs.writeFileSync(file, '# note\n/.cache/\n.temp\n!keep.me\n\n*.log\n');
  assert.deepEqual(patterns(file), ['.cache', '.temp', '*.log']);
  fs.rmSync(tmp, { recursive: true });
});

test('no package .gitignore repeats a root pattern', () => {
  const root = new Set(patterns(path.join(ROOT, '.gitignore')));
  const repeats = packageIgnores().flatMap(({ name, file }) => patterns(file)
    .filter((pattern) => root.has(pattern))
    .map((pattern) => `packages/${name}/.gitignore: ${pattern}`));
  assert.deepEqual(repeats, [], 'these lines already live in the root .gitignore');
});

test('no two package .gitignores share a pattern', () => {
  const owners = new Map();
  for (const { name, file } of packageIgnores()) {
    for (const pattern of patterns(file)) {
      owners.set(pattern, [...(owners.get(pattern) || []), name]);
    }
  }
  const shared = [...owners].filter(([, names]) => names.length > 1)
    .map(([pattern, names]) => `${pattern}: ${names.join(', ')}`);
  assert.deepEqual(shared, [], 'a line more than one package needs lives in the root .gitignore');
});

test('every package build output is ignored, and a tracked fixture dist is not', () => {
  const ignored = (file) => {
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', file], { cwd: ROOT });
      return true;
    } catch {
      return false;
    }
  };
  for (const name of fs.readdirSync(PACKAGES_DIR)) {
    assert.ok(ignored(`packages/${name}/dist/index.js`), `packages/${name}/dist is ignored`);
  }
  assert.equal(ignored('packages/extension/src/test/fixtures/consumer-extension/dist/new.js'), false);
});

test('only the manager ignores docs: it is the one package the docs lane writes into', () => {
  const docsLines = packageIgnores().flatMap(({ name, file }) => patterns(file)
    .filter((pattern) => pattern === 'docs' || pattern.startsWith('docs/'))
    .map((pattern) => `${name}: ${pattern}`));
  assert.deepEqual(docsLines, ['manager: docs']);
});
