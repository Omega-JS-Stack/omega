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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

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

module.exports = defineCases({
  type: 'group',
  description: 'translate-generate-defaults',
  tests: [
    {
      name: 'generateDefaultTranslations: renders the defaults, harvests them, and writes one namespace per default route',
      run: async (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-gen-defaults-'));
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

        const calls = [];
        const stats = await generateDefaultTranslations({ languages: ['es'], root, logger: silent, send: fakeSend(calls) });

        ctx.expect(stats.routes > 10, `the defaults tree yielded ${stats.routes} routes`).toBeTruthy();
        ctx.expect(stats.sources > 100, `the defaults tree yielded ${stats.sources} unique strings`).toBeTruthy();
        ctx.expect(stats.languages.es.translated, 'a cold run translates every harvested string exactly once').toBe(stats.sources);
        ctx.expect(calls.length, 'one provider call per batch').toBe(stats.languages.es.batches);
        ctx.expect(calls.reduce((sum, n) => sum + n, 0), 'and every string rode exactly one batch').toBe(stats.sources);

        // The framework's own auth/account/payment/portal chrome is what ships
        for (const route of ['signin', 'signup', 'account', 'payment/checkout', 'portal/email-preferences']) {
          const map = JSON.parse(fs.readFileSync(namespaceFile(root, 'es', route), 'utf8'));
          ctx.expect(Object.keys(map).length > 0, `/${route} is packaged`).toBeTruthy();
          ctx.expect(Object.keys(map).every((key) => /^[0-9a-f]{12}$/.test(key)), `/${route} keys are hash12`).toBeTruthy();
        }

        // The legal boilerplate is deliberately NOT translated, and neither the admin
        // surfaces nor the dev-only /test tree are a consumer's shipped chrome
        for (const route of ['terms', 'privacy', 'cookies', 'admin/dashboard', 'test/redirect/internal']) {
          ctx.expect(!fs.existsSync(namespaceFile(root, 'es', route)), `/${route} is never packaged`).toBeTruthy();
        }

        // The brand is stored as the sentinel, never as the render's fixture name
        const signin = fs.readFileSync(namespaceFile(root, 'es', 'signin'), 'utf8');
        ctx.expect(!signin.includes(FIXTURE_BRAND), 'the fixture brand never reaches a packaged file').toBeTruthy();
        const anyBrandString = JSON.parse(fs.readFileSync(namespaceFile(root, 'es', 'account'), 'utf8'));
        ctx.expect(Object.values(anyBrandString).some((value) => value.includes(SENTINEL)), 'brand-bearing strings keep the placeholder').toBeTruthy();

        // …and it is reachable by the key the read-through computes
        const map = JSON.parse(fs.readFileSync(namespaceFile(root, 'es', 'payment/checkout'), 'utf8'));
        ctx.expect(map[hashKey('Order summary')], 'a known checkout string resolves by its hash').toBe('Order summary·es');
      },
    },

    {
      name: 'generateDefaultTranslations: a re-run translates nothing, and adding a language costs only that language',
      run: async (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-gen-defaults-'));
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

        const first = await generateDefaultTranslations({ languages: ['es'], root, logger: silent, send: fakeSend([]) });

        // Warm: the provider must not be reached at all
        const refuse = async () => { throw new Error('a warm re-run must never call the provider'); };
        const again = await generateDefaultTranslations({ languages: ['es'], root, logger: silent, send: refuse });
        ctx.expect(again.languages.es.translated).toBe(0);
        ctx.expect(again.languages.es.reused).toBe(first.sources);

        // Adding a language pays for that language only
        const calls = [];
        const added = await generateDefaultTranslations({
          languages: ['es', 'fa'], root, logger: silent, send: fakeSend(calls, (s) => `${s.trim()}·fa`),
        });
        ctx.expect(added.languages.es.translated, 'the packaged language is untouched').toBe(0);
        ctx.expect(added.languages.fa.translated, 'the new one is translated whole').toBe(first.sources);
        ctx.expect(fs.existsSync(namespaceFile(root, 'fa', 'signin'))).toBeTruthy();
      },
    },

    {
      name: 'generateDefaultTranslations: a translation that ate the brand placeholder stops the run',
      run: async (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-gen-defaults-'));
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

        await ctx.expect(generateDefaultTranslations({
            languages: ['es'], root, logger: silent,
            // A model that "translated" the placeholder away — every brand-bearing
            // string would ship with a hole where the brand name belongs
            send: fakeSend([], (s) => s.split(SENTINEL).join('la marca')),
          })).rejects.toThrow(/lost the __OMEGA_BRAND__ placeholder/);

        ctx.expect(!fs.existsSync(path.join(root, 'es')), 'nothing was written').toBeTruthy();
      },
    },

    {
      name: 'generateDefaultTranslations: a provider failure stops the run and writes nothing',
      run: async (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-gen-defaults-'));
        ctx.after(() => fs.rmSync(root, { recursive: true, force: true }));

        await ctx.expect(generateDefaultTranslations({
            languages: ['es'], root, logger: silent,
            send: async () => { throw new Error('provider is down'); },
          })).rejects.toThrow(/provider is down/);

        ctx.expect(!fs.existsSync(path.join(root, 'es')), 'nothing was written').toBeTruthy();
      },
    },

    {
      name: 'parseLanguages reads the shipped set off the command line',
      run: (ctx) => {
        ctx.expect(parseLanguages(['--languages', 'es,fa,de'])).toEqual(['es', 'fa', 'de']);
        ctx.expect(parseLanguages(['--languages', 'es, fa '])).toEqual(['es', 'fa']);
        ctx.expect(parseLanguages([]), 'no flag means the shipped default').toBe(undefined);
      },
    },
  ],
});
