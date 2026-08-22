/**
 * `omega update` core — classification, wanted-resolution, quarantine math
 * (injected clock), file:-spec skipping, apply selection, and install-command
 * routing (npu vs npm). Registry lookups are FIXTURES — the suite never
 * touches the network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const update = require('../src/update.js');

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Frozen clock: 2026-07-21T00:00:00Z
const NOW = Date.UTC(2026, 6, 21);
const day = (daysAgo) => new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();

// Registry fixture: name → packument-ish
const REGISTRY = {
  'stable-pkg': {
    latest: '1.4.2',
    versions: ['1.2.0', '1.2.3', '1.3.0', '1.4.0', '1.4.2', '2.0.0-beta.1'],
    time: { '1.4.2': day(120), '1.4.0': day(200) },
  },
  'fresh-pkg': {
    latest: '2.1.0',
    versions: ['2.0.0', '2.0.5', '2.1.0'],
    time: { '2.1.0': day(2), '2.0.5': day(90) },
  },
  'breaking-pkg': {
    latest: '3.0.0',
    versions: ['1.0.0', '1.1.0', '1.9.4', '3.0.0'],
    time: { '3.0.0': day(30), '1.9.4': day(400) },
  },
  'current-pkg': {
    latest: '5.5.5',
    versions: ['5.5.5'],
    time: { '5.5.5': day(1000) },
  },
};

const lookup = async (name) => {
  if (!REGISTRY[name]) throw new Error(`404 for ${name}`);
  return REGISTRY[name];
};

/** Stage a target dir with a package.json and optional installed copies. */
function stageTarget(manifest, installed = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-update-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  for (const [name, version] of Object.entries(installed)) {
    const pkgDir = path.join(dir, 'node_modules', ...name.split('/'));
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name, version }));
  }
  return dir;
}

// ─── Version math ────────────────────────────────────────────────────────────

test('classifyBump: patch / minor / major / equal', () => {
  assert.equal(update.classifyBump('1.2.3', '1.2.9'), 'patch');
  assert.equal(update.classifyBump('1.2.3', '1.5.0'), 'minor');
  assert.equal(update.classifyBump('1.2.3', '2.0.0'), 'major');
  assert.equal(update.classifyBump('0.1.0', '0.2.0'), 'minor');
  assert.equal(update.classifyBump('1.2.3', '1.2.3'), null);
  assert.equal(update.classifyBump('nonsense', '1.0.0'), null);
});

test('compareVersions: ordering incl. prerelease-before-release', () => {
  assert.equal(update.compareVersions('1.2.3', '1.10.0'), -1);
  assert.equal(update.compareVersions('2.0.0-beta.1', '2.0.0'), -1);
  assert.equal(update.compareVersions('2.0.0', '2.0.0'), 0);
});

test('resolveWanted: caret / tilde / exact / star / x-range, prereleases excluded', () => {
  const versions = REGISTRY['stable-pkg'].versions;
  assert.equal(update.resolveWanted('^1.2.0', versions), '1.4.2');
  assert.equal(update.resolveWanted('~1.2.0', versions), '1.2.3');
  assert.equal(update.resolveWanted('1.3.0', versions), '1.3.0');
  assert.equal(update.resolveWanted('*', versions), '1.4.2', 'star never picks the 2.0.0-beta.1 prerelease');
  assert.equal(update.resolveWanted('1.2.x', versions), '1.2.3');
  assert.equal(update.resolveWanted('1', versions), '1.4.2');
});

test('resolveWanted: 0.x caret pins the minor', () => {
  const versions = ['0.2.0', '0.2.9', '0.3.0'];
  assert.equal(update.resolveWanted('^0.2.0', versions), '0.2.9');
});

test('highestWithin: patch / minor / latest tiers', () => {
  const versions = REGISTRY['breaking-pkg'].versions;
  assert.equal(update.highestWithin(versions, '1.0.0', 'patch'), '1.0.0');
  assert.equal(update.highestWithin(versions, '1.0.0', 'minor'), '1.9.4');
  assert.equal(update.highestWithin(versions, '1.0.0', 'latest'), '3.0.0');
});

test('isRegistrySpec: file/link/git/url/shorthand specs are non-registry', () => {
  for (const spec of ['file:../../omega/packages/web', 'link:../x', 'workspace:*', 'git+https://x.test/r.git', 'github:o/r', 'https://x.test/a.tgz', 'owner/repo']) {
    assert.equal(update.isRegistrySpec(spec), false, spec);
  }
  for (const spec of ['^1.2.3', '~0.0.1', '1.2.3', '*', 'latest']) {
    assert.equal(update.isRegistrySpec(spec), true, spec);
  }
});

// ─── Report ──────────────────────────────────────────────────────────────────

test('buildUpdateReport: rows classify, quarantine flags, file: specs skipped', async () => {
  const dir = stageTarget({
    name: 'fixture-target',
    dependencies: {
      'stable-pkg': '^1.2.3',
      'fresh-pkg': '^2.0.0',
      '@omega.js/web': 'file:../../omega/packages/web',
    },
    devDependencies: {
      'breaking-pkg': '^1.0.0',
      'current-pkg': '^5.5.5',
    },
  }, { 'stable-pkg': '1.2.3', 'fresh-pkg': '2.0.5', 'breaking-pkg': '1.0.0', 'current-pkg': '5.5.5' });

  const report = await update.buildUpdateReport({ dir, lookup, now: NOW, minAge: 7 });

  assert.equal(report.project, 'fixture-target');
  assert.deepEqual(report.locals, [{ name: '@omega.js/web', group: 'prod', spec: 'file:../../omega/packages/web' }]);

  const names = report.rows.map((row) => row.name);
  assert.ok(!names.includes('current-pkg'), 'fully-current dep does not clutter the report');
  assert.ok(!names.includes('@omega.js/web'), 'file: spec never reaches the registry');

  const stable = report.rows.find((row) => row.name === 'stable-pkg');
  assert.equal(stable.installed, '1.2.3');
  assert.equal(stable.wanted, '1.4.2');
  assert.equal(stable.latest, '1.4.2');
  assert.equal(stable.bump, 'minor');
  assert.equal(stable.quarantined, false, '120-day-old release is not fresh');
  assert.equal(stable.group, 'prod');

  const fresh = report.rows.find((row) => row.name === 'fresh-pkg');
  assert.equal(fresh.ageDays, 2);
  assert.equal(fresh.quarantined, true, '2-day-old latest is quarantined at min-age 7');

  const breaking = report.rows.find((row) => row.name === 'breaking-pkg');
  assert.equal(breaking.bump, 'major');
  assert.equal(breaking.minorTarget, '1.9.4');
  assert.equal(breaking.group, 'dev');

  // prod rows sort before dev rows
  assert.ok(names.indexOf('fresh-pkg') < names.indexOf('breaking-pkg'), 'prod group first');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildUpdateReport: quarantine clears once installed matches latest, and at min-age 0', async () => {
  const dir = stageTarget({ name: 'x', dependencies: { 'fresh-pkg': '^2.1.0' } }, { 'fresh-pkg': '2.1.0' });
  const report = await update.buildUpdateReport({ dir, lookup, now: NOW, minAge: 7 });
  assert.equal(report.rows.length, 0, 'installed latest = nothing to report');

  const dir2 = stageTarget({ name: 'y', dependencies: { 'fresh-pkg': '^2.0.0' } }, { 'fresh-pkg': '2.0.5' });
  const report2 = await update.buildUpdateReport({ dir: dir2, lookup, now: NOW, minAge: 0 });
  assert.equal(report2.rows[0].quarantined, false, 'min-age 0 disables the quarantine');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
});

test('buildUpdateReport: lookup failure surfaces as a row error, not a crash', async () => {
  const dir = stageTarget({ name: 'z', dependencies: { 'missing-pkg': '^1.0.0' } });
  const report = await update.buildUpdateReport({ dir, lookup, now: NOW });
  assert.equal(report.rows[0].error, '404 for missing-pkg');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── Apply selection ─────────────────────────────────────────────────────────

async function fixtureRows(minAge = 7) {
  const dir = stageTarget({
    name: 'sel',
    dependencies: { 'stable-pkg': '^1.2.3', 'fresh-pkg': '^2.0.0' },
    devDependencies: { 'breaking-pkg': '^1.0.0' },
  }, { 'stable-pkg': '1.2.3', 'fresh-pkg': '2.0.5', 'breaking-pkg': '1.0.0' });
  const report = await update.buildUpdateReport({ dir, lookup, now: NOW, minAge });
  fs.rmSync(dir, { recursive: true, force: true });
  return report.rows;
}

test('selectUpdates: default = non-breaking + non-quarantined; majors and fresh releases held', async () => {
  const rows = await fixtureRows();
  const selection = update.selectUpdates(rows, { minAge: 7, now: NOW });

  assert.deepEqual(selection.updates, [
    { name: 'stable-pkg', group: 'prod', from: '1.2.3', to: '1.4.2', bump: 'minor' },
    { name: 'breaking-pkg', group: 'dev', from: '1.0.0', to: '1.9.4', bump: 'minor' },
  ], 'minor tier applies; breaking-pkg rides to its same-major top, never 3.0.0');

  assert.equal(selection.quarantined.length, 1);
  assert.equal(selection.quarantined[0].name, 'fresh-pkg');
  assert.equal(selection.quarantined[0].ageDays, 2);

  assert.deepEqual(selection.majorsHeld, [{ name: 'breaking-pkg', from: '1.0.0', to: '3.0.0' }]);
});

test('selectUpdates: --major unlocks latest; --min-age 0 releases the quarantine', async () => {
  const rows = await fixtureRows();
  const withMajor = update.selectUpdates(rows, { major: true, minAge: 7, now: NOW });
  const breaking = withMajor.updates.find((entry) => entry.name === 'breaking-pkg');
  assert.deepEqual(breaking, { name: 'breaking-pkg', group: 'dev', from: '1.0.0', to: '3.0.0', bump: 'major' });
  assert.equal(withMajor.majorsHeld.length, 0);

  const forced = update.selectUpdates(rows, { minAge: 0, now: NOW });
  assert.ok(forced.updates.some((entry) => entry.name === 'fresh-pkg' && entry.to === '2.1.0'), 'quarantine lifted');
  assert.equal(forced.quarantined.length, 0);
});

// ─── Install command routing ─────────────────────────────────────────────────

test('buildInstallCommands: npu when present, npm otherwise; dev group gets --save-dev', () => {
  const updates = [
    { name: 'a', group: 'prod', from: '1.0.0', to: '1.1.0' },
    { name: 'b', group: 'dev', from: '2.0.0', to: '2.0.1' },
  ];
  assert.deepEqual(update.buildInstallCommands(updates, { hasNpu: true }), [
    { command: 'npu install a@1.1.0', group: 'prod' },
    { command: 'npu install b@2.0.1 --save-dev', group: 'dev' },
  ]);
  assert.deepEqual(update.buildInstallCommands(updates, { hasNpu: false })[0].command, 'npm install a@1.1.0');
});

// ─── The verb body ───────────────────────────────────────────────────────────

function collectLogger() {
  const lines = [];
  return { lines, log: (line) => lines.push(String(line)), warn: (line) => lines.push(`WARN ${line}`) };
}

test('runUpdate: report-only by default — no exec ever fires', async () => {
  const dir = stageTarget({ name: 'ro', dependencies: { 'stable-pkg': '^1.2.3' } }, { 'stable-pkg': '1.2.3' });
  const logger = collectLogger();
  const calls = [];

  const result = await update.runUpdate({
    dir, logger, lookup, now: NOW,
    execFn: (cmd) => calls.push(cmd),
    hasNpu: true,
  });

  assert.equal(calls.length, 0, 'report mode never installs');
  assert.equal(result.selection, null);
  assert.ok(logger.lines.some((line) => line.includes('stable-pkg')), 'table row printed');
  assert.ok(logger.lines.some((line) => line.includes('--apply')), 'apply hint printed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runUpdate --apply: installs via npu, holds quarantined + majors, warns on missing npu', async () => {
  const dir = stageTarget({
    name: 'ap',
    dependencies: { 'stable-pkg': '^1.2.3', 'fresh-pkg': '^2.0.0' },
    devDependencies: { 'breaking-pkg': '^1.0.0' },
  }, { 'stable-pkg': '1.2.3', 'fresh-pkg': '2.0.5', 'breaking-pkg': '1.0.0' });

  const logger = collectLogger();
  const calls = [];
  const result = await update.runUpdate({
    dir, logger, lookup, now: NOW, apply: true, hasNpu: true,
    execFn: (cmd, opts) => calls.push({ cmd, cwd: opts.cwd }),
  });

  assert.deepEqual(calls.map((call) => call.cmd), [
    'npu install stable-pkg@1.4.2',
    'npu install breaking-pkg@1.9.4 --save-dev',
  ]);
  assert.equal(calls[0].cwd, dir, 'installs run in the target dir');
  assert.ok(logger.lines.some((line) => line.startsWith('WARN held fresh-pkg@2.1.0')), 'quarantine hold logged');
  assert.ok(logger.lines.some((line) => line.includes('--major to include')), 'major hold logged');
  assert.equal(result.selection.updates.length, 2);

  // npm fallback path warns loudly
  const logger2 = collectLogger();
  const calls2 = [];
  await update.runUpdate({
    dir, logger: logger2, lookup, now: NOW, apply: true, hasNpu: false,
    execFn: (cmd) => calls2.push(cmd),
  });
  assert.ok(calls2.every((cmd) => cmd.startsWith('npm install')), 'plain npm fallback');
  assert.ok(logger2.lines.some((line) => line.includes('WITHOUT the Socket supply-chain firewall')), 'loud note');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('runUpdate --apply --force-fresh: quarantined release installs', async () => {
  const dir = stageTarget({ name: 'ff', dependencies: { 'fresh-pkg': '^2.0.0' } }, { 'fresh-pkg': '2.0.5' });
  const calls = [];
  await update.runUpdate({
    dir, logger: collectLogger(), lookup, now: NOW,
    apply: true, forceFresh: true, hasNpu: true,
    execFn: (cmd) => calls.push(cmd),
  });
  assert.deepEqual(calls, ['npu install fresh-pkg@2.1.0']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('formatReport: QUARANTINED status + legends + local skips', async () => {
  const dir = stageTarget({
    name: 'fmt',
    dependencies: { 'fresh-pkg': '^2.0.0', 'breaking-pkg': '^1.0.0', '@omega.js/web': 'file:../x' },
  }, { 'fresh-pkg': '2.0.5', 'breaking-pkg': '1.0.0' });
  const report = await update.buildUpdateReport({ dir, lookup, now: NOW, minAge: 7 });
  const lines = update.formatReport(report, { minAge: 7 });

  assert.ok(lines.some((line) => line.includes('fresh-pkg') && line.includes('QUARANTINED')));
  assert.ok(lines.some((line) => line.includes('QUARANTINED = latest published < 7 days ago')));
  assert.ok(lines.some((line) => line.includes('major = breaking')));
  assert.ok(lines.some((line) => line.includes('skipped @omega.js/web (file:../x)')));
  fs.rmSync(dir, { recursive: true, force: true });
});
