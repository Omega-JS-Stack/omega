/**
 * Service-runner contract tests — the ported omega-manager semantics pinned:
 * strict { state, output, status, error } handler returns, state/output
 * accumulation across handlers, setup skip, stop-on-error.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createServiceRunner, splitReturn } = require('../src/lib/service-runner.js');
const { CONSENT_REQUIRED } = require('../src/lib/google-auth.js');

// A handler that hits the Google consent gate headlessly (#228): the throw is
// CODED, so the runner steps the operation aside instead of failing the walk.
const CONSENT_THROW = `module.exports = async () => {
  const error = new Error('Google consent required (scopes: webmasters) — run the service once interactively to grant it');
  error.code = ${JSON.stringify(CONSENT_REQUIRED)};
  throw error;
};`;

// ─── splitReturn contract ────────────────────────────────────────────────────

test('splitReturn: null/undefined are no-ops', () => {
  assert.deepEqual(splitReturn(null), { state: null, output: null });
  assert.deepEqual(splitReturn(undefined), { state: null, output: null });
});

test('splitReturn: routes state and output', () => {
  const { state, output } = splitReturn({ state: { id: 1 }, output: { count: 2 } }, 'op');
  assert.deepEqual(state, { id: 1 });
  assert.deepEqual(output, { count: 2 });
});

test('splitReturn: status/error are allowed metadata', () => {
  const { state, output } = splitReturn({ status: 'warned', error: 'x', output: { a: 1 } }, 'op');
  assert.equal(state, null);
  assert.deepEqual(output, { a: 1 });
});

test('splitReturn: unknown top-level keys throw', () => {
  assert.throws(() => splitReturn({ projectId: 'leak' }, 'op'), /invalid top-level key/);
});

test('splitReturn: arrays and scalars throw', () => {
  assert.throws(() => splitReturn([1], 'op'), /returned an array/);
  assert.throws(() => splitReturn('nope', 'op'), /returned string/);
});

// ─── Runner behavior over a staged service dir ───────────────────────────────

function stageService(handlers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-svc-'));
  for (const [relative, source] of Object.entries(handlers)) {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return dir;
}

test('runner: accumulates state + output across ensure handlers, later handlers see earlier state', async () => {
  const serviceDir = stageService({
    'ensure/alpha.js': `module.exports = async () => ({ state: { a: 1 }, output: { ranA: true } });`,
    'ensure/beta.js': `module.exports = async ({ serviceData }) => ({ output: { sawA: serviceData.a } });`,
  });

  const run = createServiceRunner({ serviceDir, logOperations: false });
  const result = await run({
    operations: [{ name: 'alpha', ensure: true }, { name: 'beta', ensure: true }],
    serviceData: {},
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(result.state, { a: 1 });
  assert.deepEqual(result.output, { ranA: true, sawA: 1 });
});

test('runner: pre-loaded serviceData is initial state (cross-service reads)', async () => {
  const serviceDir = stageService({
    'ensure/reads.js': `module.exports = async ({ serviceData }) => ({ output: { existing: serviceData.fromDisk } });`,
  });

  const run = createServiceRunner({ serviceDir, logOperations: false });
  const result = await run({
    operations: [{ name: 'reads', ensure: true }],
    serviceData: { fromDisk: 'persisted-id' },
  });

  assert.equal(result.output.existing, 'persisted-id');
  // Initial serviceData rides the state accumulator (it came FROM state.json)
  assert.equal(result.state.fromDisk, 'persisted-id');
});

test('runner: stops on first error, later operations never run', async () => {
  const serviceDir = stageService({
    'ensure/boom.js': `module.exports = async () => { throw new Error('kaput'); };`,
    'ensure/after.js': `module.exports = async () => ({ output: { ran: true } });`,
  });

  const run = createServiceRunner({ serviceDir, logOperations: false });
  const result = await run({
    operations: [{ name: 'boom', ensure: true }, { name: 'after', ensure: true }],
    serviceData: {},
  });

  assert.equal(result.status, 'error');
  assert.match(result.error, /kaput/);
  assert.equal(result.output, null);
});

test('runner: contract violation in a handler surfaces as operation error', async () => {
  const serviceDir = stageService({
    'ensure/leaky.js': `module.exports = async () => ({ projectId: 'leaked-to-top-level' });`,
  });

  const run = createServiceRunner({ serviceDir, logOperations: false });
  const result = await run({
    operations: [{ name: 'leaky', ensure: true }],
    serviceData: {},
  });

  assert.equal(result.status, 'error');
  assert.match(result.error, /invalid top-level key/);
});

test('runner: warned status is sticky but never downgrades an error', async () => {
  const serviceDir = stageService({
    'ensure/warns.js': `module.exports = async () => ({ status: 'warned', output: { findings: ['x'] } });`,
    'ensure/fine.js': `module.exports = async () => ({ output: { ok: true } });`,
  });

  const run = createServiceRunner({ serviceDir, logOperations: false });
  const result = await run({
    operations: [{ name: 'warns', ensure: true }, { name: 'fine', ensure: true }],
    serviceData: {},
  });

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.output, { findings: ['x'], ok: true });
});

// ─── Consent gates are pending, not failures (#228) ──────────────────────────

test('runner: a consent-required ensure throw warns with the ⚑ marker and the walk continues', async () => {
  const serviceDir = stageService({
    'ensure/consent.js': CONSENT_THROW,
    'ensure/after.js': `module.exports = async () => ({ output: { ran: true } });`,
  });

  const run = createServiceRunner({ serviceDir, logOperations: false });
  const result = await run({
    operations: [{ name: 'consent', ensure: true }, { name: 'after', ensure: true }],
    serviceData: {},
  });

  assert.equal(result.status, 'warned');
  assert.equal(result.error, null);
  assert.match(result.output.consent.needsInteractive, /Google consent required/);
  assert.equal(result.output.ran, true, 'the operations after a pending gate still run');
});

test('runner: a consent-required read throw warns, and nothing writes on top of the gate', async () => {
  const serviceDir = stageService({
    'read/list.js': CONSENT_THROW,
    'write/list.js': `module.exports = async () => ({ output: { wrote: true } });`,
  });

  const run = createServiceRunner({ serviceDir, logOperations: false });
  const result = await run({
    operations: [{ name: 'list', read: true, write: true }],
    serviceData: {},
  });

  assert.equal(result.status, 'warned');
  assert.match(result.output.list.needsInteractive, /Google consent required/);
  assert.equal(result.output.wrote, undefined);
});

test('runner: a consent-required transform throw warns instead of failing the service', async () => {
  const serviceDir = stageService({
    'read/list.js': `module.exports = async () => ({ count: 1 });`,
    'transform/list.js': CONSENT_THROW,
    'write/list.js': `module.exports = async () => ({ output: { wrote: true } });`,
  });

  const run = createServiceRunner({ serviceDir, logOperations: false });
  const result = await run({
    operations: [{ name: 'list', read: true, write: true }],
    serviceData: {},
  });

  assert.equal(result.status, 'warned');
  assert.match(result.output.list.needsInteractive, /Google consent required/);
  assert.equal(result.output.wrote, undefined);
});

test('runner: a consent-required write throw warns instead of failing the service', async () => {
  const serviceDir = stageService({
    'write/push.js': CONSENT_THROW,
  });

  const run = createServiceRunner({ serviceDir, logOperations: false });
  const result = await run({
    operations: [{ name: 'push', write: true }],
    serviceData: {},
  });

  assert.equal(result.status, 'warned');
  assert.equal(result.error, null);
  assert.match(result.output.push.needsInteractive, /Google consent required/);
});

test('runner: setup can skip the whole service', async () => {
  const serviceDir = stageService({});

  const run = createServiceRunner({
    serviceDir,
    logOperations: false,
    setup: () => ({ skip: true, reason: 'not configured' }),
  });
  const result = await run({ operations: [{ name: 'anything', ensure: true }], serviceData: {} });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'not configured');
});

test('runner: write-only operation routes through the write handler', async () => {
  const serviceDir = stageService({
    'write/push.js': `module.exports = async () => ({ state: { pushedId: 'w-1' } });`,
  });

  const run = createServiceRunner({ serviceDir, logOperations: false });
  const result = await run({
    operations: [{ name: 'push', write: true }],
    serviceData: {},
  });

  assert.equal(result.status, 'success');
  assert.equal(result.state.pushedId, 'w-1');
});

// ─── Warned/failed operations are named, with their reason (#643) ────────────

test('runner: records each warned operation with the reason it returned', async () => {
  const serviceDir = stageService({
    'ensure/zone.js': `module.exports = async () => ({ status: 'warned', reason: 'no zone available' });`,
    'ensure/bare.js': `module.exports = async () => ({ status: 'warned' });`,
  });

  const run = createServiceRunner({ serviceDir, logOperations: false });
  const result = await run({
    operations: [{ name: 'zone', ensure: true }, { name: 'bare', ensure: true }],
    serviceData: {},
  });

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.warned, [
    { operation: 'zone', reason: 'no zone available' },
    { operation: 'bare', reason: null },
  ]);
});

test('runner: records the failed operation with its error as the reason', async () => {
  const serviceDir = stageService({
    'ensure/boom.js': `module.exports = async () => { throw new Error('kaput'); };`,
  });

  const run = createServiceRunner({ serviceDir, logOperations: false });
  const result = await run({
    operations: [{ name: 'boom', ensure: true }],
    serviceData: {},
  });

  assert.equal(result.status, 'error');
  assert.deepEqual(result.failed, [{ operation: 'boom', reason: 'kaput' }]);
});

test('runner: a warned write operation is recorded under its operation name', async () => {
  const serviceDir = stageService({
    'write/push.js': `module.exports = async () => ({ status: 'warned', reason: 'API declined the update' });`,
  });

  const run = createServiceRunner({ serviceDir, logOperations: false });
  const result = await run({
    operations: [{ name: 'push', write: true }],
    serviceData: {},
  });

  assert.deepEqual(result.warned, [{ operation: 'push', reason: 'API declined the update' }]);
});
