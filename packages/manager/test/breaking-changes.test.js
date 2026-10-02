/**
 * The breaking-changes register reader: which dated entries are due since a
 * publish day, how an entry's title reads, the lines of the by-hand block, and
 * where a brand's installed register lives. Pure functions over fixture text.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { registerPath, dueEntries, formatDueSteps } = require('../src/lib/breaking-changes.js');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REGISTER = `# Breaking changes

Every shape OMEGA changed, newest first, with its by-hand step.

## 2026-10-01: the update quarantine exempts the family

Nothing to do.

## 2026-09-30: the backend and the router have exports maps ([#1009](https://github.com/Omega-JS-Stack/omega/issues/1009))

Load \`defineCases\` from \`@omega.js/backend/test\`.

## 2026-09-20: an older shape

An older step.

## ultimate-jekyll-manager → @omega.js/web

The legacy section.
`;

// ─── dueEntries ──────────────────────────────────────────────────────────────

test('dueEntries: entries dated on or after the publish day, newest first', () => {
  assert.deepEqual(dueEntries(REGISTER, '2026-09-30T18:00:00.000Z'), [
    { date: '2026-10-01', title: 'the update quarantine exempts the family' },
    { date: '2026-09-30', title: 'the backend and the router have exports maps' },
  ]);
});

test('dueEntries: a heading with no date is skipped', () => {
  const entries = dueEntries(REGISTER, '2020-01-01T00:00:00.000Z');
  assert.deepEqual(entries.map((entry) => entry.date), ['2026-10-01', '2026-09-30', '2026-09-20']);
  assert.ok(!entries.some((entry) => entry.title.includes('ultimate-jekyll-manager')), 'the legacy section is never an entry');
});

test('dueEntries: the title drops the trailing issue link', () => {
  const text = '## 2026-09-30: the backend and the router have exports maps ([#1009](https://github.com/Omega-JS-Stack/omega/issues/1009))\n';
  assert.deepEqual(dueEntries(text, '2026-09-30T00:00:00.000Z'), [
    { date: '2026-09-30', title: 'the backend and the router have exports maps' },
  ]);
});

// ─── formatDueSteps ──────────────────────────────────────────────────────────

test('formatDueSteps: a count header, one line per entry, then the register path', () => {
  const lines = formatDueSteps({
    from: '0.54.1',
    entries: [
      { date: '2026-10-01', title: 'the update quarantine exempts the family' },
      { date: '2026-09-30', title: 'the backend and the router have exports maps' },
    ],
    file: '/brand/node_modules/@omega.js/manager/docs/shared/breaking-changes.md',
  });

  assert.deepEqual(lines, [
    'By-hand steps since 0.54.1 (2):',
    '  2026-10-01: the update quarantine exempts the family',
    '  2026-09-30: the backend and the router have exports maps',
    'Each entry\'s step is in: /brand/node_modules/@omega.js/manager/docs/shared/breaking-changes.md',
  ]);
});

// ─── registerPath ────────────────────────────────────────────────────────────

test('registerPath: the register of the manager installed in the brand', () => {
  const brand = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-breaking-changes-')));
  const manager = path.join(brand, 'node_modules', '@omega.js', 'manager');
  fs.mkdirSync(path.join(manager, 'docs', 'shared'), { recursive: true });
  fs.writeFileSync(path.join(manager, 'package.json'), JSON.stringify({ name: '@omega.js/manager', version: '0.55.0' }));
  fs.writeFileSync(path.join(manager, 'docs', 'shared', 'breaking-changes.md'), REGISTER);

  assert.equal(registerPath(brand), path.join(manager, 'docs', 'shared', 'breaking-changes.md'));
  fs.rmSync(brand, { recursive: true, force: true });
});
