/**
 * parseTestScope — the C5 test-scoping grammar (one meaning everywhere).
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { parseTestScope, isPathTargeted, noMatchMessage, noMatchExitCode, NO_MATCH_EXIT_CODE, FANOUT_ENV } = require('../src/test/scope.js');

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
  assert.deepStrictEqual(FRAMEWORK_IDS['@omega.js/web'], ['web']);
  assert.deepStrictEqual(FRAMEWORK_IDS['@omega.js/backend'], ['backend']);
  assert.deepStrictEqual(FRAMEWORK_IDS['@omega.js/desktop'], ['desktop']);
  assert.deepStrictEqual(FRAMEWORK_IDS['@omega.js/extension'], ['extension']);
});

test('a path filter means the run asked for files BY NAME (#814)', () => {
  // The no-match rule keys off this: a named path that selects nothing is a
  // typo, while a bare run (or a bare prefix) asked for a source, not a file.
  assert.strictEqual(isPathTargeted(parseTestScope(['build/config'])), true);
  assert.strictEqual(isPathTargeted(parseTestScope(['project:build/config'])), true);
  assert.strictEqual(isPathTargeted(parseTestScope(['desktop:build/config'], { frameworkAliases: ['desktop'] })), true);
  assert.strictEqual(isPathTargeted(parseTestScope(['full:build/config'])), true);

  assert.strictEqual(isPathTargeted(parseTestScope([])), false);
  assert.strictEqual(isPathTargeted(parseTestScope(['project:'])), false);
  assert.strictEqual(isPathTargeted(parseTestScope(['mgr:'])), false);
  assert.strictEqual(isPathTargeted(parseTestScope(['full:'])), false);
});

test('the no-match line is one sentence naming the target (#814)', () => {
  assert.strictEqual(noMatchMessage('renderer/does-not-exist'), 'No test file matches "renderer/does-not-exist".');
  assert.strictEqual(noMatchMessage('desktop:build/typo'), 'No test file matches "desktop:build/typo".');
});

test('a no-match exits 1 alone and with a distinct code inside a brand-root fan-out (#814)', () => {
  // The brand root forwards ONE target to every target, where a target that
  // does not carry it is a no-op rather than a typo. The code is how the
  // fan-out tells a miss from a failure.
  assert.strictEqual(NO_MATCH_EXIT_CODE, 3);
  assert.strictEqual(FANOUT_ENV, 'OMEGA_TEST_FANOUT');

  assert.strictEqual(noMatchExitCode({}), 1);
  assert.strictEqual(noMatchExitCode({ OMEGA_TEST_FANOUT: '' }), 1);
  assert.strictEqual(noMatchExitCode({ OMEGA_TEST_FANOUT: '1' }), 3);
});
