/**
 * The generator behind the packaged default-page translations (#621) —
 * `npm run translate:defaults`. Everything here is REAL except the provider
 * call: the defaults tree is rendered by the real build, harvested by the real
 * collector, and written through the real cache writer, with a fake `send` in
 * place of the model (the one seam — a real one would cost tokens per run).
 *
 * What it pins: the shape of what lands, what is deliberately left out (the
 * legal boilerplate, the admin and dev-only trees), the idempotency that makes
 * "add a language" cheap, and the two loud stops — a provider failure and a
 * translation that ate the brand sentinel both write nothing.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { CONTROL, hashKey } = require('@omega.js/devkit/translate');
const { generateDefaultTranslations, parseLanguages, FIXTURE_BRAND } = require('../src/translate/generate-defaults.js');
const { SENTINEL, pageNamespace } = require('../src/translate/packaged-defaults.js');

const silent = { log: () => {}, warn: () => {}, error: () => {} };

/**
 * Fake provider speaking the engine's protocol: same-length array back, the
 * control sentinel untouched, each string mapped by `render`.
 */
function fakeSend(calls, render = (s) => `${s.trim()}·es`) {
  return async ({ user }) => {
    const payload = JSON.parse(user.slice(user.indexOf('\n\n') + 2));
    calls.push(payload.length - 1);

    return { text: JSON.stringify(payload.map((s) => (s === CONTROL ? s : render(s)))), usage: { input: 1, output: 1 } };
  };
}

const namespaceFile = (root, lang, route) => path.join(root, lang, `${pageNamespace(route)}.json`);

test('generateDefaultTranslations: renders the defaults, harvests them, and writes one namespace per default route', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-gen-defaults-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const calls = [];
  const stats = await generateDefaultTranslations({ languages: ['es'], root, logger: silent, send: fakeSend(calls) });

  assert.ok(stats.routes > 10, `the defaults tree yielded ${stats.routes} routes`);
  assert.ok(stats.sources > 100, `the defaults tree yielded ${stats.sources} unique strings`);
  assert.strictEqual(stats.languages.es.translated, stats.sources, 'a cold run translates every harvested string exactly once');
  assert.strictEqual(calls.length, stats.languages.es.batches, 'one provider call per batch');
  assert.strictEqual(calls.reduce((sum, n) => sum + n, 0), stats.sources, 'and every string rode exactly one batch');

  // The framework's own auth/account/payment/portal chrome is what ships
  for (const route of ['signin', 'signup', 'account', 'payment/checkout', 'portal/email-preferences']) {
    const map = JSON.parse(fs.readFileSync(namespaceFile(root, 'es', route), 'utf8'));
    assert.ok(Object.keys(map).length > 0, `/${route} is packaged`);
    assert.ok(Object.keys(map).every((key) => /^[0-9a-f]{12}$/.test(key)), `/${route} keys are hash12`);
  }

  // The legal boilerplate is deliberately NOT translated, and neither the admin
  // surfaces nor the dev-only /test tree are a consumer's shipped chrome
  for (const route of ['terms', 'privacy', 'cookies', 'admin/dashboard', 'test/redirect/internal']) {
    assert.ok(!fs.existsSync(namespaceFile(root, 'es', route)), `/${route} is never packaged`);
  }

  // The brand is stored as the sentinel, never as the render's fixture name
  const signin = fs.readFileSync(namespaceFile(root, 'es', 'signin'), 'utf8');
  assert.ok(!signin.includes(FIXTURE_BRAND), 'the fixture brand never reaches a packaged file');
  const anyBrandString = JSON.parse(fs.readFileSync(namespaceFile(root, 'es', 'account'), 'utf8'));
  assert.ok(Object.values(anyBrandString).some((value) => value.includes(SENTINEL)), 'brand-bearing strings keep the placeholder');

  // …and it is reachable by the key the read-through computes
  const map = JSON.parse(fs.readFileSync(namespaceFile(root, 'es', 'payment/checkout'), 'utf8'));
  assert.strictEqual(map[hashKey('Order summary')], 'Order summary·es', 'a known checkout string resolves by its hash');
});

test('generateDefaultTranslations: a re-run translates nothing, and adding a language costs only that language', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-gen-defaults-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const first = await generateDefaultTranslations({ languages: ['es'], root, logger: silent, send: fakeSend([]) });

  // Warm: the provider must not be reached at all
  const refuse = async () => { throw new Error('a warm re-run must never call the provider'); };
  const again = await generateDefaultTranslations({ languages: ['es'], root, logger: silent, send: refuse });
  assert.strictEqual(again.languages.es.translated, 0);
  assert.strictEqual(again.languages.es.reused, first.sources);

  // Adding a language pays for that language only
  const calls = [];
  const added = await generateDefaultTranslations({
    languages: ['es', 'fa'], root, logger: silent, send: fakeSend(calls, (s) => `${s.trim()}·fa`),
  });
  assert.strictEqual(added.languages.es.translated, 0, 'the packaged language is untouched');
  assert.strictEqual(added.languages.fa.translated, first.sources, 'the new one is translated whole');
  assert.ok(fs.existsSync(namespaceFile(root, 'fa', 'signin')));
});

test('generateDefaultTranslations: a translation that ate the brand placeholder stops the run', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-gen-defaults-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  await assert.rejects(
    generateDefaultTranslations({
      languages: ['es'], root, logger: silent,
      // A model that "translated" the placeholder away — every brand-bearing
      // string would ship with a hole where the brand name belongs
      send: fakeSend([], (s) => s.split(SENTINEL).join('la marca')),
    }),
    /lost the __OMEGA_BRAND__ placeholder/,
  );

  assert.ok(!fs.existsSync(path.join(root, 'es')), 'nothing was written');
});

test('generateDefaultTranslations: a provider failure stops the run and writes nothing', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-gen-defaults-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  await assert.rejects(
    generateDefaultTranslations({
      languages: ['es'], root, logger: silent,
      send: async () => { throw new Error('provider is down'); },
    }),
    /provider is down/,
  );

  assert.ok(!fs.existsSync(path.join(root, 'es')), 'nothing was written');
});

test('parseLanguages reads the shipped set off the command line', () => {
  assert.deepStrictEqual(parseLanguages(['--languages', 'es,fa,de']), ['es', 'fa', 'de']);
  assert.deepStrictEqual(parseLanguages(['--languages', 'es, fa ']), ['es', 'fa']);
  assert.strictEqual(parseLanguages([]), undefined, 'no flag means the shipped default');
});
