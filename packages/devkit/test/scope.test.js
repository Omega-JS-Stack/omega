/**
 * parseTestScope — the C5 test-scoping grammar (one meaning everywhere).
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { parseTestScope } = require('../src/test/scope.js');

test('no targets in consumer context → project only', () => {
  const scope = parseTestScope([]);
  assert.deepStrictEqual(scope.sources, ['project']);
  assert.deepStrictEqual(scope.filters, { framework: [], project: [] });
  assert.deepStrictEqual(scope.invalid, []);
});

test('no targets in framework self context → framework only', () => {
  const scope = parseTestScope([], { selfTest: true });
  assert.deepStrictEqual(scope.sources, ['framework']);
});

test('bare path binds to project source', () => {
  const scope = parseTestScope(['pages/pricing']);
  assert.deepStrictEqual(scope.sources, ['project']);
  assert.deepStrictEqual(scope.filters.project, ['pages/pricing']);
  assert.deepStrictEqual(scope.filters.framework, []);
});

test('framework:/omega:/mgr: select the framework suite', () => {
  for (const prefix of ['framework', 'omega', 'mgr']) {
    const scope = parseTestScope([`${prefix}:`]);
    assert.deepStrictEqual(scope.sources, ['framework'], prefix);
  }
});

test('per-framework alias (backend:, em:) via frameworkAliases', () => {
  const scope = parseTestScope(['backend:routes/'], { frameworkAliases: ['backend'] });
  assert.deepStrictEqual(scope.sources, ['framework']);
  assert.deepStrictEqual(scope.filters.framework, ['routes/']);
});

test('project:/brand: are explicit project aliases', () => {
  for (const prefix of ['project', 'brand']) {
    const scope = parseTestScope([`${prefix}:auth/`]);
    assert.deepStrictEqual(scope.sources, ['project'], prefix);
    assert.deepStrictEqual(scope.filters.project, ['auth/'], prefix);
  }
});

test('full: selects both sources, path applies to both', () => {
  const bare = parseTestScope(['full:']);
  assert.deepStrictEqual(bare.sources, ['framework', 'project']);

  const scoped = parseTestScope(['full:auth']);
  assert.deepStrictEqual(scoped.filters.framework, ['auth']);
  assert.deepStrictEqual(scoped.filters.project, ['auth']);
});

test('mixed targets union sources with per-source filters', () => {
  const scope = parseTestScope(['framework:admin/', 'checkout'], { frameworkAliases: ['backend'] });
  assert.deepStrictEqual(scope.sources, ['framework', 'project']);
  assert.deepStrictEqual(scope.filters.framework, ['admin/']);
  assert.deepStrictEqual(scope.filters.project, ['checkout']);
});

test('unknown prefix is reported invalid, not silently dropped', () => {
  const scope = parseTestScope(['framwork:oops']);
  assert.deepStrictEqual(scope.invalid, ['framwork:oops']);
  // Falls back to the consumer default rather than matching nothing.
  assert.deepStrictEqual(scope.sources, ['project']);
});

test('windows-style path with drive colon is not treated as a prefix', () => {
  // `C:` would match `<word>:` — the prefix grammar is lowercase-only, so
  // an uppercase drive letter stays a bare path.
  const scope = parseTestScope(['C:/tests/x']);
  assert.deepStrictEqual(scope.sources, ['project']);
  assert.deepStrictEqual(scope.filters.project, ['C:/tests/x']);
});

test('FRAMEWORK_IDS covers exactly the dispatcher\'s frameworks with the cp94a id sets', () => {
  const { FRAMEWORK_IDS } = require('../src/test/scope.js');
  const { FRAMEWORKS } = require('../src/omega-bin.js');

  assert.deepStrictEqual(Object.keys(FRAMEWORK_IDS).sort(), [...FRAMEWORKS].sort());
  assert.deepStrictEqual(FRAMEWORK_IDS['@omega.js/web'], ['web', 'ujm']);
  assert.deepStrictEqual(FRAMEWORK_IDS['@omega.js/backend'], ['backend']);
  assert.deepStrictEqual(FRAMEWORK_IDS['@omega.js/desktop'], ['desktop', 'em']);
  assert.deepStrictEqual(FRAMEWORK_IDS['@omega.js/extension'], ['extension', 'bxm']);
});
