// Tests for the workspace env-keys op (#569) and its derivation from the env
// schema (#581) — the brand-generated .env keys: nobody can paste them from a
// dashboard, so the manager is the only thing that can put them in a brand's
// .env. ONE list feeds both lanes (the onboard scaffold stub, the manage-time
// mint) and it lives in @omega.js/config's env schema, minting is
// skip-when-present, and a value the cascade already serves (a company .env)
// is never re-minted into the brand file.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ENV_SCHEMA, generatedEnvKeys } = require('@omega.js/config');
const { buildScaffoldPlan } = require('../src/lib/scaffold.js');

const GENERATED_ENV_KEYS = generatedEnvKeys();

const envKeysOp = require('../src/services/workspace/ensure/env-keys.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-env-keys-'));
}

/**
 * Run the op with every generated key absent from the cascade (the state a
 * brand onboarded before the key existed is in), restoring the process env
 * afterwards — a real value must never leak between tests.
 */
async function runOp(context, { present = {} } = {}) {
  const saved = {};
  for (const name of Object.keys(GENERATED_ENV_KEYS)) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  Object.assign(process.env, present);

  try {
    return await envKeysOp({ options: {}, ...context });
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('env-keys op: a brand .env missing UNSUBSCRIBE_HMAC_KEY gains a minted one', async () => {
  const brandRoot = tmpdir();
  try {
    // The playground's shape (#569): every other key present, this one never minted
    fs.writeFileSync(path.join(brandRoot, '.env'), 'OMEGA_ADMIN_KEY="admin"\nOMEGA_WEBHOOK_KEY="webhook"\nOMEGA_NAMESPACE="ns"\n');

    const result = await runOp({ brandRoot }, { present: { OMEGA_ADMIN_KEY: 'admin', OMEGA_WEBHOOK_KEY: 'webhook', OMEGA_NAMESPACE: 'ns' } });
    assert.deepEqual(result.output.envKeys.minted, ['UNSUBSCRIBE_HMAC_KEY']);
    assert.deepEqual(result.output.envKeys.present, ['OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE']);

    const env = fs.readFileSync(path.join(brandRoot, '.env'), 'utf8');
    // 32 random bytes as hex, double-quoted like every other value
    assert.match(env, /^UNSUBSCRIBE_HMAC_KEY="[0-9a-f]{64}"$/m);
    // The keys already there are untouched
    assert.match(env, /^OMEGA_ADMIN_KEY="admin"$/m);
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('env-keys op: idempotent — a second run mints nothing and changes no value', async () => {
  const brandRoot = tmpdir();
  try {
    fs.writeFileSync(path.join(brandRoot, '.env'), '# Fixture Brand — brand secrets.\n');

    const first = await runOp({ brandRoot });
    assert.deepEqual(first.output.envKeys.minted, Object.keys(GENERATED_ENV_KEYS));
    const afterFirst = fs.readFileSync(path.join(brandRoot, '.env'), 'utf8');

    // The mint publishes into process.env so the SAME run's disperse composes
    // it into targets/backend/.env — a rerun sees the values it just wrote
    const minted = Object.fromEntries(Object.keys(GENERATED_ENV_KEYS)
      .map((name) => [name, /^.*="(.*)"$/m.exec(afterFirst.split('\n').find((line) => line.startsWith(`${name}=`)))[1]]));

    const second = await runOp({ brandRoot }, { present: minted });
    assert.deepEqual(second.output.envKeys.minted, []);
    assert.equal(fs.readFileSync(path.join(brandRoot, '.env'), 'utf8'), afterFirst);
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('env-keys op: a key the cascade already serves is never minted into the brand file', async () => {
  const brandRoot = tmpdir();
  try {
    fs.writeFileSync(path.join(brandRoot, '.env'), 'GH_TOKEN="gh"\n');

    // The company .env supplied it (manage loads the chain before any service runs)
    const result = await runOp({ brandRoot }, { present: { UNSUBSCRIBE_HMAC_KEY: 'from-company' } });
    assert.ok(result.output.envKeys.present.includes('UNSUBSCRIBE_HMAC_KEY'));

    const env = fs.readFileSync(path.join(brandRoot, '.env'), 'utf8');
    assert.ok(!/^UNSUBSCRIBE_HMAC_KEY=/m.test(env), 'the brand file never shadows the company value');
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('env-keys op: dry run plans, writes nothing', async () => {
  const brandRoot = tmpdir();
  try {
    const before = 'GH_TOKEN="gh"\n';
    fs.writeFileSync(path.join(brandRoot, '.env'), before);

    const result = await runOp({ brandRoot, options: { dryRun: true } });
    assert.deepEqual(result.output.envKeys.planned, Object.keys(GENERATED_ENV_KEYS));
    assert.equal(result.output.envKeys.minted.length, 0);
    assert.equal(fs.readFileSync(path.join(brandRoot, '.env'), 'utf8'), before);
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('env-keys: a key added to the env schema reaches both lanes with no other edit', async () => {
  // The whole point of #581: the mint list, the .env grouping, and the
  // disperse composition DERIVE from @omega.js/config's env schema, so a new
  // key is one entry there — never four edits across the manager.
  ENV_SCHEMA.push({
    name:        'FIXTURE_DERIVED_KEY',
    owner:       'workspace',
    targets:     ['backend'],
    group:       'omega',
    generated:   () => 'fixture-derived-value',
    secret:      true,
    required:    false,
    description: 'Fixture key, pushed by the derivation test only.',
  });

  const brandRoot = tmpdir();
  try {
    fs.writeFileSync(path.join(brandRoot, '.env'), '# Fixture Brand — brand secrets.\n');

    // Lane 1 — the manage-time mint
    const result = await runOp({ brandRoot });
    assert.ok(result.output.envKeys.minted.includes('FIXTURE_DERIVED_KEY'), 'the env-keys op mints it');
    assert.match(fs.readFileSync(path.join(brandRoot, '.env'), 'utf8'), /^FIXTURE_DERIVED_KEY="fixture-derived-value"$/m);

    // Lane 2 — the onboard scaffold stub
    const plan = buildScaffoldPlan({ id: 'acme', name: 'Acme', url: 'https://acme.dev', email: 'hi@acme.dev', targets: ['backend'] });
    const stub = plan.find((file) => file.path === '.env').contents;
    assert.match(stub, /^FIXTURE_DERIVED_KEY="fixture-derived-value"$/m, 'the onboard stub provisions it');
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
    delete process.env.FIXTURE_DERIVED_KEY;
    ENV_SCHEMA.pop();
  }
});

test('env-keys: the onboard stub mints the SAME list, double-quoted', () => {
  const plan = buildScaffoldPlan({ id: 'acme', name: 'Acme', url: 'https://acme.dev', email: 'hi@acme.dev', targets: ['backend'] });
  const stub = plan.find((file) => file.path === '.env').contents;

  for (const name of Object.keys(GENERATED_ENV_KEYS)) {
    assert.match(stub, new RegExp(`^${name}="[^"]+"$`, 'm'), `${name} is provisioned in the stub`);
  }
  assert.match(stub, /^UNSUBSCRIBE_HMAC_KEY="[0-9a-f]{64}"$/m);
});
