/**
 * Region detection (`core/js/libs/consent-region.js`, #383) — the heuristic
 * that decides whether a visitor is asked BEFORE anything loads (opt-in) or
 * told after (opt-out).
 *
 * The zone list has to hold on its own, because getting it wrong in the
 * permissive direction means loading a tracker on someone the GDPR protects.
 * The three shapes that matter: `Europe/*`, the four EEA zones that sit outside
 * that prefix, and everything the runtime cannot place at all — which is opt-in
 * too, on purpose.
 *
 * Browser code behind no aliases, but driven through esbuild like every other
 * core/js suite so the REAL file is what runs.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_JS = path.join(__dirname, '..', 'core', 'js');
const ENTRY = path.join(CORE_JS, 'libs', 'consent-region.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-consent-region-'));
const BUNDLE = path.join(BUNDLE_DIR, 'consent-region.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
  });

  return building;
}

async function load() {
  await bundleOnce();
  delete require.cache[require.resolve(BUNDLE)];
  return require(BUNDLE);
}

test('every Europe/* zone is opt-in', async () => {
  const { requiresOptIn } = await load();

  for (const zone of ['Europe/Berlin', 'Europe/Paris', 'Europe/Dublin', 'Europe/London', 'Europe/Lisbon', 'Europe/Warsaw']) {
    assert.strictEqual(requiresOptIn(zone), true, `${zone} needs consent before anything loads`);
  }

  // Zone names are matched case-insensitively, because Intl accepts them that
  // way: a case-sensitive prefix test read `europe/berlin` as unplaceable, and
  // "unplaceable" is the branch that then has to guess.
  assert.strictEqual(requiresOptIn('europe/berlin'), true, 'casing never changes the answer');
});

test('the four EEA zones outside the Europe/ prefix are opt-in too', async () => {
  const { requiresOptIn } = await load();

  // The prefix alone misses these: Iceland, the Canaries, Madeira, the Azores.
  for (const zone of ['Atlantic/Reykjavik', 'Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Azores']) {
    assert.strictEqual(requiresOptIn(zone), true, `${zone} is in the EEA`);
  }
});

test('the rest of the world is opt-out', async () => {
  const { requiresOptIn } = await load();

  for (const zone of ['America/New_York', 'America/Los_Angeles', 'America/Sao_Paulo', 'Asia/Tokyo', 'Australia/Sydney', 'Africa/Cairo', 'UTC']) {
    assert.strictEqual(requiresOptIn(zone), false, `${zone} loads its scripts and gets the informational banner`);
  }
});

test('a missing or unplaceable timezone fails toward compliance', async () => {
  const { requiresOptIn } = await load();

  // Missing: the browser had no answer for us — which is what detectTimeZone()
  // hands back when Intl is absent or throws.
  for (const value of ['', '   ', null, 42]) {
    assert.strictEqual(requiresOptIn(value), true, `${JSON.stringify(value)} tells us nothing, so we ask first`);
  }

  // Unplaceable: a string that is not a zone the runtime knows tells us nothing
  // either — reading it as "not Europe" is the one guess that costs something.
  for (const zone of ['Mars/Olympus', 'Nowhere', 'Europe']) {
    assert.strictEqual(requiresOptIn(zone), true, `${zone} is not a zone we can place`);
  }
});

test('detectRegion names the regime the consent record stores', async () => {
  const { detectRegion } = await load();

  assert.strictEqual(detectRegion('Europe/Berlin'), 'opt-in');
  assert.strictEqual(detectRegion('America/New_York'), 'opt-out');
  assert.strictEqual(detectRegion(''), 'opt-in');
});

test('with no argument it reads the environment\'s own timezone', async () => {
  const { requiresOptIn, detectTimeZone } = await load();
  const original = process.env.TZ;

  try {
    process.env.TZ = 'Europe/Berlin';
    assert.strictEqual(detectTimeZone(), 'Europe/Berlin');
    assert.strictEqual(requiresOptIn(), true, 'a Berlin browser is opt-in without being told');

    process.env.TZ = 'America/New_York';
    assert.strictEqual(requiresOptIn(), false, 'a New York browser is opt-out');
  } finally {
    process.env.TZ = original;
  }
});
