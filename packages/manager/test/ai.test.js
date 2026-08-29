// Tests for the ai service (#639) — the ONE key per AI provider, asked once.
// The service provisions nothing: its whole job is the setup contract's gate
// for OPENAI_API_KEY / ANTHROPIC_API_KEY, so a brand that wants AI pastes
// them mid-walk and a brand that does not answers Disable once. Both keys are
// OPTIONAL (`gates: false`) — preflight never gates a run on them.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { REQUIRES, SERVICE_ORDER, OPERATIONS, serviceInputSpec } = require('../src/config.js');
const { run } = require('../src/services/ai/index.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const { openTtyPrompt } = require('./lib/interactive.js');

const KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
const DOWN = '\x1B[B';

function cleanup() {
  for (const name of KEYS) delete process.env[name];
}

/** Stub the real browser launch — pressEnterToOpen's seam. */
function stubBrowser() {
  const promptModule = require('@omega.js/devkit/prompt');
  const real = promptModule.openInBrowser;
  const opened = [];

  promptModule.openInBrowser = (url) => { opened.push(url); return true; };

  return { opened, restore: () => { promptModule.openInBrowser = real; } };
}

function context(brandRoot, brandConfig = {}, options = {}) {
  return {
    brandId: 'b',
    brandRoot,
    brandConfig,
    operations: OPERATIONS.ai,
    options,
  };
}

test('ai: the registry declares both provider keys as OPTIONAL inputs', () => {
  const declaration = REQUIRES.ai;

  assert.equal(declaration.label, 'AI providers');
  assert.equal(declaration.disablePath, 'ai.enabled');
  assert.deepEqual(declaration.env.map((entry) => entry.name), KEYS);

  for (const entry of declaration.env) {
    assert.equal(entry.prompted, true, `${entry.name} is collected mid-run on a TTY`);
    assert.equal(entry.gates, false, `${entry.name} is optional — preflight never gates on it`);
    assert.match(entry.url, /^https:\/\//, `${entry.name} names the page that mints it`);
    assert.ok(entry.hint, `${entry.name} says what to make there`);
  }

  // The when clause mirrors the service's own gate — absence means ask
  assert.equal(declaration.when({}), true);
  assert.equal(declaration.when({ ai: { enabled: false } }), false);

  assert.ok(SERVICE_ORDER.includes('ai'), 'the walk runs it');
  assert.deepEqual(serviceInputSpec('ai').inputs.map((entry) => entry.name), KEYS);
});

test('ai: both keys already in the environment → nothing asked', async () => {
  const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');
  for (const name of KEYS) process.env[name] = 'already-set';

  try {
    const result = await run(context(brandRoot));
    assert.equal(result.status, 'success');
    assert.equal(fs.existsSync(path.join(brandRoot, '.env')), false, 'nothing was written');
  } finally {
    cleanup();
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('ai: PROVIDE → both keys land in the brand .env and export for this run', async () => {
  cleanup();
  const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');
  fs.writeFileSync(path.join(brandRoot, '.env'), 'EXISTING_KEY="keep-me"\n');

  const tty = openTtyPrompt();
  const browser = stubBrowser();
  try {
    const running = run(context(brandRoot));
    await tty.answer('Set up now?', '\r');                       // Provide
    await tty.answer('Press Enter to open the OpenAI API key page', '\r');
    await tty.answer('Paste OPENAI_API_KEY', 'openai-fixture\r');
    await tty.answer('Press Enter to open the Anthropic API key page', '\r');
    await tty.answer('Paste ANTHROPIC_API_KEY', 'anthropic-fixture\r');
    const result = await running;

    assert.equal(result.status, 'success');
    assert.equal(process.env.OPENAI_API_KEY, 'openai-fixture');
    assert.equal(process.env.ANTHROPIC_API_KEY, 'anthropic-fixture');

    const env = fs.readFileSync(path.join(brandRoot, '.env'), 'utf8');
    assert.match(env, /EXISTING_KEY="keep-me"/);
    assert.match(env, /OPENAI_API_KEY="openai-fixture"/);
    assert.match(env, /ANTHROPIC_API_KEY="anthropic-fixture"/);
    // Providing never disables anything
    assert.doesNotMatch(readConfigSource(brandRoot), /enabled/);
    assert.deepEqual(browser.opened, [
      'https://platform.openai.com/api-keys',
      'https://console.anthropic.com/settings/keys',
    ]);
  } finally {
    tty.close();
    browser.restore();
    cleanup();
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('ai: DISABLE → ai.enabled: false lands in omega.json5 and nothing asks again', async () => {
  cleanup();
  const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n  // keep me\n  ai: {},\n}\n');
  const brandConfig = { brand: { id: 'b' }, ai: {} };

  const tty = openTtyPrompt();
  try {
    const running = run(context(brandRoot, brandConfig));
    await tty.answer('Set up now?', `${DOWN}${DOWN}\r`);          // Disable
    const result = await running;

    assert.equal(result.status, 'skipped');
    assert.match(result.reason, /ai\.enabled/);
    assert.deepEqual(result.missingEnv, KEYS);

    const source = readConfigSource(brandRoot);
    assert.match(source, /enabled: false/);
    assert.match(source, /\/\/ keep me/);
    assert.equal(brandConfig.ai.enabled, false);
    assert.equal(process.env.OPENAI_API_KEY, undefined);
  } finally {
    tty.close();
    cleanup();
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('ai: a disabled brand skips before any gate opens', async () => {
  cleanup();
  const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n  ai: { enabled: false },\n}\n');

  const tty = openTtyPrompt();
  try {
    const result = await run(context(brandRoot, { ai: { enabled: false } }));
    assert.equal(result.status, 'skipped');
    assert.match(result.reason, /ai\.enabled/);
  } finally {
    tty.close();
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('ai: a non-interactive run never prompts — it names the keys and moves on', async () => {
  cleanup();
  const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');

  try {
    const result = await run(context(brandRoot, {}, { dryRun: true }));
    assert.equal(result.status, 'skipped');
    assert.deepEqual(result.missingEnv, KEYS);
    assert.equal(fs.existsSync(path.join(brandRoot, '.env')), false);
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});
