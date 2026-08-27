// Tests for src/lib/service-input.js (#608) — the ONE setup contract every
// service asks its inputs through: present → proceed; missing +
// non-interactive → a LOUD skip line with the machine-readable missingEnv
// list; missing + interactive → the uniform Provide / Skip this run / Disable
// permanently gate, whose Disable lands the service's `enabled: false` in
// omega.json5 so it never asks again. Plus the sweep: every credential the env
// schema (#581) says a service acquires is declared in the registry, every
// service with declared inputs routes through this helper, and the gate's
// wording has exactly one home.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ENV_SCHEMA, envFileGroups } = require('@omega.js/config/env-schema');
const { REQUIRES, SERVICE_ORDER, serviceInputSpec } = require('../src/config.js');
const { requestServiceInput } = require('../src/lib/service-input.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const { openTtyPrompt } = require('./lib/interactive.js');

const VAR = 'OMEGA_TEST_FAKE_INPUT';
const VAR2 = 'OMEGA_TEST_FAKE_INPUT_TWO';
const DOWN = '\x1B[B';

function cleanup(...names) {
  for (const name of names) delete process.env[name];
}

/** A spec with one required input, disabling into `fake.enabled`. */
function fakeSpec(inputs = [{ name: VAR, label: 'Fake token' }]) {
  return {
    service: 'fake',
    label: 'Fake service',
    disablePath: 'fake.enabled',
    inputs,
  };
}

function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    return { result: fn(), lines };
  } finally {
    console.log = original;
  }
}

// ─── the three outcomes ──────────────────────────────────────────────────────

test('service-input: every input present → proceed, nothing asked', async () => {
  process.env[VAR] = 'already-set';
  try {
    const gate = await requestServiceInput({ brandRoot: '/nope', brandConfig: {}, options: {} }, fakeSpec());
    assert.equal(gate, null);
  } finally {
    cleanup(VAR);
  }
});

test('service-input: missing + non-interactive → a LOUD skip line and the missingEnv list', async () => {
  cleanup(VAR, VAR2);
  const captured = captureLog(() => requestServiceInput(
    { brandRoot: '/nope', brandConfig: {}, options: {} },
    fakeSpec([{ name: VAR }, { name: VAR2 }]),
  ));
  const gate = await captured.result;

  assert.equal(gate.skip, true);
  assert.deepEqual(gate.missingEnv, [VAR, VAR2]);
  assert.match(gate.reason, new RegExp(`${VAR}, ${VAR2}`));
  assert.match(gate.reason, /rerun interactively/);
  // Loud: the skip NAMES the keys on its own line, never a silent step-aside
  assert.match(captured.lines.join('\n'), new RegExp(`${VAR}.*${VAR2}`));
});

test('service-input: dry run never prompts, even on a TTY', async () => {
  cleanup(VAR);
  const tty = openTtyPrompt();
  try {
    const gate = await requestServiceInput(
      { brandRoot: '/nope', brandConfig: {}, options: { dryRun: true } },
      fakeSpec(),
    );
    assert.equal(gate.skip, true);
    assert.deepEqual(gate.missingEnv, [VAR]);
  } finally {
    tty.close();
  }
});

test('service-input: PROVIDE → pastes, saves to the brand .env, exports, proceeds', async () => {
  cleanup(VAR);
  const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');
  fs.writeFileSync(path.join(brandRoot, '.env'), 'EXISTING_KEY="keep-me"\n');

  const tty = openTtyPrompt();
  try {
    const run = requestServiceInput({ brandRoot, brandConfig: {}, brandId: 'b', options: {} }, fakeSpec());
    await tty.answer('Set up now?', '\r');            // Provide
    await tty.answer(`Paste ${VAR}`, 'pasted-value\r');
    const gate = await run;

    assert.equal(gate, null);
    assert.equal(process.env[VAR], 'pasted-value');
    const env = fs.readFileSync(path.join(brandRoot, '.env'), 'utf8');
    assert.match(env, /EXISTING_KEY="keep-me"/);
    assert.match(env, new RegExp(`${VAR}="pasted-value"`));
    // Providing never disables anything
    assert.doesNotMatch(readConfigSource(brandRoot), /enabled/);
  } finally {
    tty.close();
    cleanup(VAR);
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('service-input: SKIP THIS RUN → skips without writing config or .env', async () => {
  cleanup(VAR);
  const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');

  const tty = openTtyPrompt();
  try {
    const run = requestServiceInput({ brandRoot, brandConfig: {}, brandId: 'b', options: {} }, fakeSpec());
    await tty.answer('Set up now?', `${DOWN}\r`);      // Skip for now
    const gate = await run;

    assert.equal(gate.skip, true);
    assert.equal(gate.disabled, undefined);
    assert.deepEqual(gate.missingEnv, [VAR]);
    assert.equal(process.env[VAR], undefined);
    assert.equal(fs.existsSync(path.join(brandRoot, '.env')), false);
    assert.doesNotMatch(readConfigSource(brandRoot), /enabled/);
  } finally {
    tty.close();
    cleanup(VAR);
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('service-input: DISABLE PERMANENTLY → lands enabled: false in omega.json5 and stops asking', async () => {
  cleanup(VAR);
  const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n  // keep me\n  fake: {},\n}\n');
  const brandConfig = { brand: { id: 'b' }, fake: {} };

  const tty = openTtyPrompt();
  try {
    const run = requestServiceInput({ brandRoot, brandConfig, brandId: 'b', options: {} }, fakeSpec());
    await tty.answer('Set up now?', `${DOWN}${DOWN}\r`); // Disable (stop prompting)
    const gate = await run;

    assert.equal(gate.skip, true);
    assert.equal(gate.disabled, true);
    assert.match(gate.reason, /fake\.enabled/);
    // Permanent: written to config (comments preserved) and to the in-memory
    // config, so nothing later in the same run asks again
    const source = readConfigSource(brandRoot);
    assert.match(source, /enabled: false/);
    assert.match(source, /\/\/ keep me/);
    assert.equal(brandConfig.fake.enabled, false);
    assert.equal(process.env[VAR], undefined);
  } finally {
    tty.close();
    cleanup(VAR);
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('service-input: an already-disabled service never prompts again', async () => {
  cleanup(VAR);
  const tty = openTtyPrompt();
  try {
    const gate = await requestServiceInput(
      { brandRoot: '/nope', brandConfig: { fake: { enabled: false } }, options: {} },
      fakeSpec(),
    );
    assert.equal(gate.skip, true);
    assert.match(gate.reason, /fake\.enabled/);
  } finally {
    tty.close();
    cleanup(VAR);
  }
});

test('service-input: a url\'d input walks to the exact mint page before the paste', async () => {
  cleanup(VAR);
  const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');

  const tty = openTtyPrompt();
  const events = [];
  try {
    const run = requestServiceInput(
      { brandRoot, brandConfig: {}, brandId: 'b', options: {} },
      fakeSpec([{ name: VAR, label: 'Fake token', url: 'https://example.com/mint', hint: 'Create one with scopes: fake:write' }]),
      { prompt: { pressEnterToOpen: async (url, label) => { events.push([url, label]); return true; } } },
    );
    await tty.answer('Set up now?', '\r');
    await tty.answer(`Paste ${VAR}`, 'v\r');
    const gate = await run;

    assert.equal(gate, null);
    assert.deepEqual(events, [['https://example.com/mint', 'the Fake token page']]);
    assert.equal(process.env[VAR], 'v');
  } finally {
    tty.close();
    cleanup(VAR);
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('service-input: an empty paste skips this run (no writeback, no export)', async () => {
  cleanup(VAR);
  const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');

  const tty = openTtyPrompt();
  try {
    const run = requestServiceInput({ brandRoot, brandConfig: {}, brandId: 'b', options: {} }, fakeSpec());
    await tty.answer('Set up now?', '\r');
    await tty.answer(`Paste ${VAR}`, '   \r');
    const gate = await run;

    assert.equal(gate.skip, true);
    assert.deepEqual(gate.missingEnv, [VAR]);
    assert.equal(process.env[VAR], undefined);
    assert.equal(fs.existsSync(path.join(brandRoot, '.env')), false);
  } finally {
    tty.close();
    cleanup(VAR);
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('service-input: entry-level `when` drops inputs this brand does not need', async () => {
  cleanup(VAR, VAR2);
  const gate = await requestServiceInput(
    { brandRoot: '/nope', brandConfig: { registrar: 'other' }, options: {} },
    fakeSpec([
      { name: VAR },
      { name: VAR2, when: (config) => config.registrar === 'namecheap' },
    ]),
  );

  assert.deepEqual(gate.missingEnv, [VAR]);
});

// ─── the sweep ───────────────────────────────────────────────────────────────

const SRC_DIR = path.join(__dirname, '..', 'src');

// Keys the manager reads but must NEVER open a setup gate for — each with the
// reason, so a new exemption is a deliberate line, not a silent gap.
const NOT_A_SETUP_GATE = {
  // One of THREE optional Mr. Logo tiers, and only for a brand with no
  // committed brandmark — the ordinary case is committed art, so an ask would
  // nag every fresh brand, and the only opt-out coarse enough to land
  // (`assets.enabled: false`) would kill icons and favicons with it.
  MRLOGO_SERVICE_ACCOUNT: 'an optional generation tier, not a gate on the assets service',
};

/** Every .js file under a src subtree, as [relative path, contents]. */
function sourceFiles(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(entry.parentPath || entry.path, entry.name))
    .map((file) => [path.relative(SRC_DIR, file), fs.readFileSync(file, 'utf8')]);
}

/**
 * The service INPUTS, derived — not hand-kept: an acquired credential the env
 * schema (#581) assigns to a manage service AND the manager's own source
 * actually reads. A key it never reads (a backend-runtime key whose `owner`
 * only names the provisioning domain, a build-time path) is nobody's prompt.
 */
function serviceInputKeys() {
  const fileGroups = new Set(envFileGroups().map((group) => group.id));
  const sources = sourceFiles(SRC_DIR);

  return ENV_SCHEMA.filter((entry) => entry.name
    && !entry.generated                       // OMEGA mints it — no one to ask
    && entry.group !== 'machine'              // a service writes it on its first real run
    && fileGroups.has(entry.group)            // schema-only groups never reach a .env
    && SERVICE_ORDER.includes(entry.owner)    // owned by a manage service, not the backend runtime
    && !NOT_A_SETUP_GATE[entry.name]
    && sources.some(([, text]) => text.includes(`process.env.${entry.name}`)
      || text.includes(`process.env[${JSON.stringify(entry.name)}]`)));
}

test('sweep: every credential a service actually reads is declared in the REQUIRES registry', () => {
  const keys = serviceInputKeys();
  // The derivation must not quietly collapse to nothing
  assert.ok(keys.length > 10, `expected the manager to read many credentials, found ${keys.length}`);

  const undeclared = keys
    .filter((entry) => !(REQUIRES[entry.owner]?.env || []).some((input) => input.name === entry.name))
    .map((entry) => `${entry.owner}: ${entry.name}`);

  assert.deepEqual(undeclared, [], 'declare these in src/config.js REQUIRES so the shared setup contract can ask for them');
});

test('sweep: every REQUIRES entry can run the three-outcome gate', () => {
  for (const [service, declaration] of Object.entries(REQUIRES)) {
    assert.ok(declaration.label, `REQUIRES.${service} needs a label (the gate's human name)`);
    assert.ok(declaration.disablePath, `REQUIRES.${service} needs a disablePath (where "Disable permanently" lands false)`);

    const spec = serviceInputSpec(service);
    assert.equal(spec.service, service);
    assert.equal(spec.disablePath, declaration.disablePath);
    assert.ok(spec.inputs.length > 0, `REQUIRES.${service} declares no inputs`);
  }
});

test('sweep: every service with declared inputs routes them through the shared helper', () => {
  const routed = (service) => sourceFiles(path.join(SRC_DIR, 'services', service))
    .some(([, text]) => text.includes('service-input.js'));

  const handRolled = Object.keys(REQUIRES).filter((service) => !routed(service));
  assert.deepEqual(handRolled, [], 'these services declare inputs but never call requestServiceInput');
});

test('run-summary: skipped-for-secrets services aggregate into the 🔑 section', () => {
  const { RunSummary } = require('../src/lib/run-summary.js');

  const summary = new RunSummary();
  summary.add('brand-a', 'Brand A', 'edge', { status: 'skipped', reason: 'missing CLOUDFLARE_TOKEN', missingEnv: ['CLOUDFLARE_TOKEN'] });
  summary.add('brand-a', 'Brand A', 'domain', { status: 'skipped', reason: 'missing NAMECHEAP…', missingEnv: ['NAMECHEAP_USERNAME', 'NAMECHEAP_API_KEY'] });
  summary.add('brand-a', 'Brand A', 'repo', { status: 'success' });

  const { lines } = captureLog(() => summary.printSummary());

  const text = lines.join('\n');
  assert.match(text, /Missing secrets/);
  assert.match(text, /edge: CLOUDFLARE_TOKEN/);
  assert.match(text, /domain: NAMECHEAP_USERNAME, NAMECHEAP_API_KEY/);
  assert.match(text, /--service=edge/);
  assert.match(text, /--service=domain/);
});

test('sweep: the Provide / Skip / Disable wording has exactly ONE home', () => {
  const homes = sourceFiles(SRC_DIR)
    .filter(([, text]) => text.includes('Disable (stop prompting)'))
    .map(([file]) => file);

  assert.deepEqual(homes, ['lib/config-flow.js'], 'the gate is confirmSetup — never a second copy');
});
