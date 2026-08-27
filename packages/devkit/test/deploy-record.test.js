/**
 * Deploy record (cp196): brand-root-resolved `<target>` under the `deploy`
 * section of .omega/state.json — written by deploy verbs, read by the
 * testing service to split never-deployed (nudge) from deployed-but-down
 * (error). state.json is the ONE sectioned record file (#479): a brand still
 * carrying the interim .omega/deploys.json (0.45.0) has it adopted once,
 * loudly, and a brand still carrying retired config-shaped keys beside its
 * records keeps them untouched.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { recordDeploy, readDeployRecord, deployKey } = require('../src/deploy-record.js');
const { stripAnsi } = require('../src/attach-log-file.js');

function makeBrand() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-record-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"brand"}');
  fs.mkdirSync(path.join(root, 'targets', 'website'), { recursive: true });
  fs.writeFileSync(path.join(root, 'targets', 'website', 'package.json'), '{"name":"brand-website"}');
  return root;
}

function readState(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.omega', 'state.json'), 'utf8'));
}

function readRecords(root) {
  return readState(root).deploy;
}

function writeState(root, state) {
  fs.mkdirSync(path.join(root, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(root, '.omega', 'state.json'), JSON.stringify(state));
}

function writeLegacyDeploys(root, records) {
  fs.mkdirSync(path.join(root, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(root, '.omega', 'deploys.json'), JSON.stringify(records));
}

// Capture the adoption notices a call prints; returns { result, lines }.
function capture(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(stripAnsi(args.map(String).join(' ')));
  try {
    return { result: fn(), lines };
  } finally {
    console.log = original;
  }
}

test('recordDeploy resolves to the brand root from a target dir; readDeployRecord sees it from anywhere', () => {
  const root = makeBrand();
  const targetDir = path.join(root, 'targets', 'website');

  assert.equal(readDeployRecord({ dir: targetDir, target: 'web' }), null);

  const written = recordDeploy({ dir: targetDir, target: 'web', detail: { method: 'dispatch' } });
  assert.ok(written.at, 'stamped');
  assert.equal(written.method, 'dispatch');

  const records = readRecords(root);
  assert.equal(records.web.method, 'dispatch', 'record lands at the BRAND root, not the target');

  assert.equal(readDeployRecord({ dir: root, target: 'web' }).method, 'dispatch');
  assert.equal(readDeployRecord({ dir: targetDir, target: 'backend' }), null, 'target-scoped');

  fs.rmSync(root, { recursive: true, force: true });
});

test('instance keys (multi-instance targets): main stays the bare target, other instances key <target>:<id>', () => {
  const root = makeBrand();

  assert.equal(deployKey('web'), 'web');
  assert.equal(deployKey('web', 'main'), 'web', 'main IS the bare key — existing records stay valid');
  assert.equal(deployKey('web', 'admin'), 'web:admin');

  recordDeploy({ dir: root, target: 'web', instance: 'main', detail: { method: 'dispatch' } });
  recordDeploy({ dir: root, target: 'web', instance: 'admin', detail: { method: 'direct' } });

  assert.deepEqual(Object.keys(readRecords(root)).sort(), ['web', 'web:admin'], 'per-target records, distinct keys');

  assert.equal(readDeployRecord({ dir: root, target: 'web' }).method, 'dispatch', 'instance-less read = the primary');
  assert.equal(readDeployRecord({ dir: root, target: 'web', instance: 'admin' }).method, 'direct');
  assert.equal(readDeployRecord({ dir: root, target: 'web', instance: 'cdn' }), null, 'instance-scoped');

  fs.rmSync(root, { recursive: true, force: true });
});

test('recordDeploy preserves other targets', () => {
  const root = makeBrand();

  recordDeploy({ dir: root, target: 'backend' });
  recordDeploy({ dir: root, target: 'web' });

  const records = readRecords(root);
  assert.ok(records.backend.at, 'other targets survive');
  assert.ok(records.web.at);

  fs.rmSync(root, { recursive: true, force: true });
});

test('a foreign top-level state.json section survives a record write untouched (#479)', () => {
  const root = makeBrand();
  writeState(root, { install: { lastCheck: '2026-08-22T00:00:00.000Z', packages: ['web'] } });

  recordDeploy({ dir: root, target: 'web', detail: { method: 'direct' } });

  const state = readState(root);
  assert.deepEqual(state.install, { lastCheck: '2026-08-22T00:00:00.000Z', packages: ['web'] }, 'other fact kinds are read-through, never rewritten');
  assert.equal(state.deploy.web.method, 'direct', 'the deploy section is the only one this module writes');

  fs.rmSync(root, { recursive: true, force: true });
});

test('a standalone .omega/deploys.json is adopted into state.json, LOUDLY, and the old file goes (#479)', () => {
  const root = makeBrand();
  writeLegacyDeploys(root, { backend: { at: '2026-08-01T00:00:00.000Z', method: 'firebase' } });

  const { result, lines } = capture(() => readDeployRecord({ dir: root, target: 'backend' }));

  assert.equal(result.method, 'firebase', 'the old record is not lost');
  assert.deepEqual(readRecords(root).backend, { at: '2026-08-01T00:00:00.000Z', method: 'firebase' }, 'adopted whole, stamps intact');
  assert.equal(fs.existsSync(path.join(root, '.omega', 'deploys.json')), false, 'the old file is removed');

  assert.equal(lines.length, 1, 'ONE line, not a per-record chorus');
  assert.match(lines[0], /\[@omega\.js\/devkit:deploy-record\]/, 'the log-tag convention');
  assert.match(lines[0], /deploys\.json/, 'names what was adopted');
  assert.match(lines[0], /state\.json/, 'names where it landed');
  assert.match(lines[0], /removed/, 'says the old file went');

  const quiet = capture(() => recordDeploy({ dir: root, target: 'web' }));
  assert.deepEqual(quiet.lines, [], 'adoption is ONE-TIME — the next write is silent');
  assert.equal(readRecords(root).backend.method, 'firebase', 'the adopted record survives the next write');

  fs.rmSync(root, { recursive: true, force: true });
});

test('an EMPTY legacy deploys.json is cleaned up silently — no "Adopted 0" line (#479)', () => {
  const root = makeBrand();
  writeLegacyDeploys(root, {});

  const { lines } = capture(() => recordDeploy({ dir: root, target: 'web' }));

  assert.equal(fs.existsSync(path.join(root, '.omega', 'deploys.json')), false, 'the empty husk still goes');
  assert.deepEqual(lines, [], 'nothing was adopted, so nothing is announced');

  fs.rmSync(root, { recursive: true, force: true });
});

test('an unmigrated brand reads its records in place — retired keys untouched, nothing announced (#479)', () => {
  const root = makeBrand();
  writeState(root, {
    edge: { zoneId: 'zone-abc' },
    search: { propertyUrl: 'sc-domain:fixture-brand.test' },
    deploy: { backend: { at: '2026-07-17T00:00:00.000Z', method: 'firebase' } },
  });

  const { result, lines } = capture(() => readDeployRecord({ dir: root, target: 'backend' }));
  assert.equal(result.method, 'firebase', 'the record is already home — read in place, no adoption');
  assert.deepEqual(lines, [], 'nothing moved, so nothing is announced');

  const quiet = capture(() => recordDeploy({ dir: root, target: 'web', detail: { method: 'direct' } }));
  assert.deepEqual(quiet.lines, [], 'the write is silent too');

  const state = readState(root);
  assert.equal(state.deploy.backend.method, 'firebase', 'the existing record survives the write');
  assert.equal(state.deploy.web.method, 'direct');
  assert.deepEqual(state.edge, { zoneId: 'zone-abc' }, 'retired content is the state-retirement migration\'s to move, never this module\'s');
  assert.deepEqual(state.search, { propertyUrl: 'sc-domain:fixture-brand.test' });

  fs.rmSync(root, { recursive: true, force: true });
});

test('a record already in state.json wins over the legacy file it adopts beside', () => {
  const root = makeBrand();
  recordDeploy({ dir: root, target: 'web', detail: { method: 'direct' } });
  writeLegacyDeploys(root, { web: { at: '2021-01-01T00:00:00.000Z', method: 'stale-file' }, desktop: { at: 'd' } });

  capture(() => {
    assert.equal(readDeployRecord({ dir: root, target: 'web' }).method, 'direct', 'the newer write is the record');
  });

  assert.equal(readDeployRecord({ dir: root, target: 'desktop' }).at, 'd', 'the rest of the old file is still adopted');

  fs.rmSync(root, { recursive: true, force: true });
});
