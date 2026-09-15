/**
 * The targets map keyed by NAME (#886): entry enumeration and its missing-type
 * throw, the name-IS-the-folder path derivation, the target-dir walk, the
 * public-url resolution, and the dev-port offset among same-type siblings.
 *
 * Fixtures are built under packages/config/.temp/ (gitignored), matching the
 * loader test convention.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  targetEntries, targetsOfType, hasTargetOfType, targetPath, targetNameFromDir, targetUrl, targetPortOffset,
  TARGET_NAME_PATTERN, TARGET_TYPES,
} = require('../src/index.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

// Build a fixture tree ({ 'relative/path': contents }) and return its root.
function makeFixture(name, files) {
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

// Ian's own example (#886): two web targets, a backend, a desktop, a custom one
const BRAND = {
  brand: { id: 'somiibo', name: 'Somiibo', url: 'https://somiibo.com' },
  targets: {
    web: { type: 'web', url: 'https://somiibo.com' },
    community: { type: 'web', url: 'https://community.somiibo.com' },
    backend: { type: 'backend' },
    desktop: { type: 'desktop' },
    docs: { type: 'custom' },
  },
};

// ─── targetEntries ───

test('targetEntries: { name, type, ...entry } in config order; no targets = []', () => {
  const entries = targetEntries(BRAND);

  assert.deepStrictEqual(entries.map((entry) => entry.name), ['web', 'community', 'backend', 'desktop', 'docs']);
  assert.deepStrictEqual(entries[1], { type: 'web', url: 'https://community.somiibo.com', name: 'community' });

  assert.deepStrictEqual(targetEntries({ brand: { id: 'acme' } }), []);
  assert.deepStrictEqual(targetEntries(undefined), []);

  assert.deepStrictEqual(targetsOfType(BRAND, 'web').map((entry) => entry.name), ['web', 'community']);
  assert.deepStrictEqual(targetsOfType(BRAND, 'custom').map((entry) => entry.name), ['docs']);

  // The type list is the frameworks plus custom, and nothing else
  assert.deepStrictEqual(TARGET_TYPES, ['web', 'backend', 'desktop', 'extension', 'mobile', 'custom']);
  assert.ok(TARGET_NAME_PATTERN.test('community') && !TARGET_NAME_PATTERN.test('Community Site'));
});

test('targetEntries: an entry with no type, or an unknown one, throws naming the key', () => {
  assert.throws(
    () => targetEntries({ targets: { web: { type: 'web' }, admin: {} } }),
    /targets\.admin must declare a type.*got nothing/,
  );
  assert.throws(
    () => targetEntries({ targets: { admin: { type: 'website' } } }),
    /targets\.admin must declare a type.*"website"/,
  );
});

// ─── hasTargetOfType (the ONE presence gate) ───

test('hasTargetOfType: by TYPE, so a backend named api still gates the backend services', () => {
  assert.equal(hasTargetOfType(BRAND, 'backend'), true);
  assert.equal(hasTargetOfType(BRAND, 'mobile'), false);
  assert.equal(hasTargetOfType({ targets: { api: { type: 'backend' } } }, 'backend'), true);

  // Raw, unvalidated configs answer instead of throwing
  assert.equal(hasTargetOfType({ targets: { admin: {} } }, 'web'), false);
  assert.equal(hasTargetOfType({ brand: { id: 'acme' } }, 'web'), false);
  assert.equal(hasTargetOfType(undefined, 'web'), false);
});

// ─── targetPath (the name IS the folder) ───

test('targetPath: targets/<name>, and an undeclared name throws with the declared list', () => {
  assert.strictEqual(targetPath(BRAND, 'community'), 'targets/community');
  assert.strictEqual(targetPath(BRAND, 'web'), 'targets/web');

  assert.throws(() => targetPath(BRAND, 'website'), /No target "website" is declared/);
  assert.throws(() => targetPath(BRAND, 'website'), /web, community, backend, desktop, docs/);
});

// ─── targetNameFromDir ───

test('targetNameFromDir: the target root names it inside a brand (functions/ and dist/ normalize up); null outside', (t) => {
  const root = makeFixture('targets-dir-walk', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, targets: { web: { type: 'web' }, admin: { type: 'web' }, backend: { type: 'backend' } } }`,
    'targets/web/package.json': '{}',
    'targets/admin/package.json': '{}',
    'targets/backend/functions/package.json': '{}',
  });
  cleanup(t, root);

  assert.strictEqual(targetNameFromDir(path.join(root, 'targets', 'web')), 'web');
  assert.strictEqual(targetNameFromDir(path.join(root, 'targets', 'admin')), 'admin');
  assert.strictEqual(targetNameFromDir(path.join(root, 'targets', 'backend', 'functions')), 'backend');
  assert.strictEqual(targetNameFromDir(path.join(root, 'targets', 'admin', 'dist')), 'admin');

  // A STANDALONE project's dir name is arbitrary, so it names no target
  const standalone = makeFixture('admin', {
    'config/omega.json5': `{ brand: { id: 'solo', name: 'Solo' }, targets: { web: { type: 'web' } } }`,
  });
  cleanup(t, standalone);
  assert.strictEqual(targetNameFromDir(standalone), null);
});

// ─── targetUrl ───

test('targetUrl: entry url, then an entry brand.url, then the derivation', () => {
  const config = {
    brand: { url: 'https://acme.test' },
    targets: {
      web: { type: 'web' },
      store: { type: 'web', url: 'https://shop.acme.com' },
      help: { type: 'web', brand: { url: 'https://help.zendesk.com' } },
      admin: { type: 'web' },
      backend: { type: 'backend' },
    },
  };

  assert.strictEqual(targetUrl(config, 'store'), 'https://shop.acme.com');
  assert.strictEqual(targetUrl(config, 'help'), 'https://help.zendesk.com');

  // Named for its type = the brand itself, never web.acme.test
  assert.strictEqual(targetUrl(config, 'web'), 'https://acme.test');
  assert.strictEqual(targetUrl(config, 'backend'), 'https://acme.test');

  // Any other name IS the subdomain, which is what makes a bare entry complete
  assert.strictEqual(targetUrl(config, 'admin'), 'https://admin.acme.test');
  // A name with no entry at all still derives, since the name is the whole input
  assert.strictEqual(targetUrl(config, 'cdn'), 'https://cdn.acme.test');
});

test('targetUrl: the host is taken exactly as brand.url states it (www kept, path dropped, port kept)', () => {
  const targets = { admin: { type: 'web' } };

  assert.strictEqual(targetUrl({ brand: { url: 'https://www.acme.test' }, targets }, 'admin'), 'https://admin.www.acme.test');
  assert.strictEqual(targetUrl({ brand: { url: 'https://acme.test/base/' }, targets }, 'admin'), 'https://admin.acme.test');
  assert.strictEqual(targetUrl({ brand: { url: 'acme.test:8080' }, targets }, 'admin'), 'https://admin.acme.test:8080');
});

test('targetUrl: no brand url at all is null, never a half-derived https://admin.', () => {
  const targets = { admin: { type: 'web' } };

  assert.strictEqual(targetUrl({ targets }, 'admin'), null);
  assert.strictEqual(targetUrl(undefined, 'admin'), null);
  // An unparseable brand.url derives nothing rather than guessing a host
  assert.strictEqual(targetUrl({ brand: { url: 'https://' }, targets }, 'admin'), null);
});

// ─── targetPortOffset ───

test('targetPortOffset: position among the SAME-type targets, so side-by-side dev ports', () => {
  const config = {
    targets: {
      web: { type: 'web' },
      backend: { type: 'backend' },
      community: { type: 'web' },
    },
  };

  assert.strictEqual(targetPortOffset(config, 'web'), 0);
  assert.strictEqual(targetPortOffset(config, 'community'), 1, 'the backend between them does not shift the second web target');
  assert.strictEqual(targetPortOffset(config, 'backend'), 0);

  // Unknown names stay at the classic base
  assert.strictEqual(targetPortOffset(config, 'nope'), 0);
  assert.strictEqual(targetPortOffset(undefined, 'web'), 0);
});
